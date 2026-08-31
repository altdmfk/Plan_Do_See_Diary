import { CONFIG } from './config.js';

export const authClient = {
  session: null,

  init() {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
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

  setSession(data) {
    if (!data || !data.access_token) return;
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      user: data.user
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_SESSION, JSON.stringify(this.session));
    }
  },

  clearSession() {
    this.session = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH_SESSION);
    }
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

  async _request(endpoint, method, body = null) {
    if (!CONFIG.SUPABASE.URL || !CONFIG.SUPABASE.ANON_KEY) {
      throw new Error('Cloud configuration missing');
    }

    const headers = {
      'apikey': CONFIG.SUPABASE.ANON_KEY,
      'Content-Type': 'application/json'
    };

    const token = this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`; // T07-C112: Token via header only
    }

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${CONFIG.SUPABASE.URL}/auth/v1${endpoint}`, opts);
    let data = {};
    try {
      data = await res.json();
    } catch(e) {}
    
    if (!res.ok) {
      throw { status: res.status, error: data };
    }
    return data;
  },

  async login(email, password) {
    try {
      const data = await this._request('/token?grant_type=password', 'POST', { email, password });
      this.setSession(data);
      return data;
    } catch (err) {
      throw new Error('Invalid login credentials'); // T07-C99
    }
  },

  async signup(email, password) {
    try {
      const data = await this._request('/signup', 'POST', { email, password });
      if (data?.user?.identities && data.user.identities.length === 0) {
        throw new Error('Duplicate account'); 
      }
      if (data.session) {
        this.setSession(data.session);
      }
      return data;
    } catch (err) {
      throw new Error('Invalid login credentials'); // T07-C98 & T07-C99
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
