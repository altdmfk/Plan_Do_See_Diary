import { CONFIG } from './config.js';

export const authClient = {
  session: null,
  _listeners: new Set(),

  init() {
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : (typeof window !== 'undefined' ? window.sessionStorage : null);
    if (!storage) return;
    
    const stored = storage.getItem(CONFIG.STORAGE_KEYS.AUTH_SESSION);
    if (stored) {
      try {
        const s = JSON.parse(stored);
        if (s.expires_at && s.expires_at > (Date.now() / 1000)) {
          this.session = s;
        } else {
          this.clearSession();
        }
      } catch (e) {
        this.clearSession();
      }
    }
  },

  onAuthStateChange(callback) {
    if (typeof callback === 'function') {
      this._listeners.add(callback);
      return () => this._listeners.delete(callback);
    }
    return () => {};
  },

  _notifyAuthStateChange(event, session = null) {
    for (const listener of this._listeners) {
      try {
        listener(event, session);
      } catch (err) {}
    }
  },

  setSession(data) {
    if (!data || !data.access_token) return;
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user
    };
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_SESSION, JSON.stringify(this.session));
    }
  },

  clearSession() {
    const hadSession = this.session !== null;
    this.session = null;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH_SESSION);
    }
    if (hadSession) {
      this._notifyAuthStateChange('SIGNED_OUT', null);
    }
  },

  async getSession() {
    if (!this.session) {
      this.init();
    }
    if (this.session && this.session.expires_at <= (Date.now() / 1000)) {
      this.clearSession();
    }
    return this.session;
  },

  isAuthenticated() {
    if (this.session && this.session.expires_at <= (Date.now() / 1000)) {
      this.clearSession(); // Auto-expire cleanup
    }
    return this.session !== null;
  },

  getAccessToken() {
    return this.isAuthenticated() ? this.session.access_token : null;
  },

  getUserId() {
    return this.isAuthenticated() ? this.session?.user?.id || null : null;
  },

  getUserEmail() {
    return this.isAuthenticated() ? (this.session?.user?.email || null) : null;
  },

  _isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  },

  async deleteAccount() {
    if (!this.isAuthenticated()) return;
    const token = this.getAccessToken();
    try {
      if (CONFIG.SUPABASE.URL && CONFIG.SUPABASE.ANON_KEY && token) {
        const headers = {
          'apikey': CONFIG.SUPABASE.ANON_KEY,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/rpc/delete_user_account`, {
          method: 'POST',
          headers
        }).catch(() => {});
      }
    } catch (e) {}
    // Immediately purge cached client-side session tokens
    this.clearSession();
  },

  async _request(endpoint, method = 'GET', body = null, retryOnFutureJwt = true) {
    if (!CONFIG.SUPABASE.URL || !CONFIG.SUPABASE.ANON_KEY) {
      return {
        code: 500,
        error_code: 'cloud_config_missing',
        msg: 'Cloud configuration missing'
      };
    }

    const headers = {
      'apikey': CONFIG.SUPABASE.ANON_KEY,
      'Content-Type': 'application/json'
    };

    // Public auth endpoints must NEVER attach user tokens (causes Supabase to reject with 'No API key found in request')
    const isPublicAuthRoute = endpoint.startsWith('/signup') ||
      endpoint.startsWith('/token') ||
      endpoint.startsWith('/recover') ||
      endpoint.startsWith('/verify') ||
      endpoint.startsWith('/otp');

    const token = this.getAccessToken();
    if (token && !isPublicAuthRoute) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      headers['Authorization'] = `Bearer ${CONFIG.SUPABASE.ANON_KEY}`;
    }

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/auth/v1${endpoint}`, opts);
      let data = {};
      try {
        const text = await res.text();
        if (text) {
          data = JSON.parse(text);
        }
      } catch (e) {
        data = {};
      }

      if (!res.ok) {
        if (res.status === 401 && retryOnFutureJwt && (JSON.stringify(data).includes('JWT issued at future') || JSON.stringify(data).includes('PGRST303'))) {
          await new Promise(r => setTimeout(r, 1500));
          return this._request(endpoint, method, body, false);
        }
        return {
          code: data?.code || res.status,
          error_code: data?.error_code || data?.code || data?.error || 'auth_error',
          msg: data?.msg || data?.message || data?.error_description || `Auth error: ${res.status}`,
          error: data
        };
      }
      return data;
    } catch (err) {
      return {
        code: 0,
        error_code: 'network_error',
        msg: '네트워크 연결 상태를 확인해 주세요.'
      };
    }
  },

  async login(email, password) {
    const normEmail = (email || '').trim().toLowerCase();
    if (!this._isValidEmail(normEmail)) {
      return {
        code: 400,
        error_code: 'invalid_credentials',
        msg: '아이디 또는 비밀번호가 올바르지 않습니다.'
      };
    }

    try {
      const res = await this._request('/token?grant_type=password', 'POST', { email: normEmail, password });
      if (res && (res.error || res.error_code || (res.code && res.code >= 400))) {
        const errObj = res.error || res;
        const code = Number(errObj.code || res.code || errObj.status || 400);
        const error_code = String(errObj.error_code || errObj.error || 'invalid_credentials').toLowerCase();
        const rawMsg = String(errObj.msg || errObj.message || errObj.error_description || '').toLowerCase();

        let msg = '아이디 또는 비밀번호가 올바르지 않습니다.';
        if (error_code.includes('email_not_confirmed') || rawMsg.includes('email not confirmed')) {
          msg = '이메일 인증이 완료되지 않은 계정입니다.';
        }

        return {
          code,
          error_code,
          msg
        };
      }

      const data = res;
      const userId = data?.user?.id || ('usr_' + normEmail.replace(/[^a-zA-Z0-9]/g, '_'));

      if (!data.user) {
        data.user = { id: userId, email: normEmail };
      } else if (!data.user.email) {
        data.user.email = normEmail;
      }
      
      this.setSession(data);
      return {
        success: true,
        data,
        session: data,
        user: data.user,
        access_token: data.access_token
      };
    } catch (err) {
      return {
        code: 400,
        error_code: 'invalid_credentials',
        msg: '아이디 또는 비밀번호가 올바르지 않습니다.'
      };
    }
  },

  async signup(email, password) {
    const normEmail = (email || '').trim().toLowerCase();
    if (!this._isValidEmail(normEmail)) {
      return {
        code: 400,
        error_code: 'invalid_email',
        msg: '올바른 이메일 형식을 입력해 주세요.'
      };
    }
    if (!password || password.length < 6) {
      return {
        code: 400,
        error_code: 'password_too_short',
        msg: '비밀번호는 최소 6자 이상이어야 합니다.'
      };
    }
    try {
      const res = await this._request('/signup', 'POST', { email: normEmail, password });
      if (res && (res.error || res.error_code || (res.code && res.code >= 400))) {
        const errObj = res.error || res;
        const code = Number(errObj.code || res.code || errObj.status || 400);
        const error_code = String(errObj.error_code || errObj.code || errObj.error || 'signup_failed').toLowerCase();
        const rawMsg = String(errObj.msg || errObj.message || errObj.error_description || '').toLowerCase();

        let msg = '회원가입 처리 중 오류가 발생했습니다.';
        if (code === 422 || error_code === 'user_already_exists' || rawMsg.includes('already') || rawMsg.includes('exists')) {
          msg = '이미 가입된 이메일입니다.';
        } else if (error_code === 'password_too_short' || rawMsg.includes('password') || rawMsg.includes('최소 6자')) {
          msg = '비밀번호는 최소 6자 이상이어야 합니다.';
        } else if (error_code === 'invalid_email' || rawMsg.includes('email')) {
          msg = '올바른 이메일 형식을 입력해 주세요.';
        }

        return {
          code,
          error_code,
          msg
        };
      }

      const data = res;
      if (data?.user?.identities && data.user.identities.length === 0) {
        return {
          code: 422,
          error_code: 'user_already_exists',
          msg: '이미 가입된 이메일입니다.'
        };
      }
      if (data.session) {
        if (!data.session.user && data.user) data.session.user = data.user;
        if (data.session.user && !data.session.user.email) data.session.user.email = normEmail;
        this.setSession(data.session);
      } else if (data.user) {
        if (!data.user.email) data.user.email = normEmail;
        this.setSession({ ...data, access_token: data.access_token || 'mock_token' });
      }
      return {
        success: true,
        data,
        session: data.session || data,
        user: data.user,
        access_token: data.access_token || (data.session && data.session.access_token)
      };
    } catch (err) {
      return {
        code: 500,
        error_code: 'signup_failed',
        msg: '회원가입 처리 중 오류가 발생했습니다.'
      };
    }
  },

  async logout() {
    if (this.isAuthenticated()) {
      try {
        await this._request('/logout', 'POST');
      } catch (e) {} // Silent cleanup
    }
    this.clearSession();
  }
};
