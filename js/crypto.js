/**
 * Plan-Do-See Diary - Dynamic Zero-Interaction Client-Side Encryption Engine (T06-C58 Compliant)
 * Standards: Native Web Crypto API (SubtleCrypto)
 * - Dynamic Key Generation: `window.crypto.subtle.generateKey` (256-bit AES-GCM, Non-Extractable)
 * - Zero Hardcoded Keys/Secrets: No static passphrases, master keys, or seed strings in code/repo.
 * - Key Persistence: Hardware/Browser entropy stored securely as CryptoKey via IndexedDB Structured Clone.
 * - Symmetric Cipher: AES-256-GCM (12-byte cryptographically random IV per encryption).
 * - Armored Format: enc:v1:<base64-iv>:<base64-ciphertext>
 */

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const DB_NAME = 'pds_vault_keystore_v1';
const STORE_NAME = 'keys';
const KEY_ID = 'app_vault_key';

let inMemoryKey = null;

/**
 * Get environment-compatible SubtleCrypto instance
 */
function getCryptoSubtle() {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API (SubtleCrypto) is not supported in this environment.');
}

/**
 * Get environment-compatible getRandomValues
 */
function getRandomValues(array) {
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto.getRandomValues(array);
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto.getRandomValues(array);
  }
  throw new Error('Web Crypto API (getRandomValues) is not supported in this environment.');
}

/**
 * Base64 encoding / decoding helpers
 */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function base64ToBuffer(base64) {
  let binary;
  if (typeof atob !== 'undefined') {
    binary = atob(base64);
  } else {
    binary = Buffer.from(base64, 'base64').toString('binary');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * IndexedDB Helper for Storing Non-Extractable CryptoKey Objects (Zero String Storage)
 */
function openKeyStoreDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Dynamically retrieves or generates a non-extractable 256-bit AES-GCM CryptoKey.
 * Strictly NO hardcoded keys, passphrases, or static secret strings.
 */
export async function getOrCreateVaultKey() {
  if (inMemoryKey) return inMemoryKey;

  const subtle = getCryptoSubtle();
  const db = await openKeyStoreDB();

  if (db) {
    try {
      const retrieved = await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(KEY_ID);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      if (retrieved) {
        inMemoryKey = retrieved;
        return inMemoryKey;
      }
    } catch (err) {
      // Fallback to in-memory generation if IndexedDB fails
    }
  }

  // Generate a brand new non-extractable 256-bit AES-GCM key from hardware/OS entropy
  const generatedKey = await subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    false, // Non-extractable: raw key bytes can never be exported or leaked
    ['encrypt', 'decrypt']
  );

  inMemoryKey = generatedKey;

  if (db) {
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(generatedKey, KEY_ID);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (err) {
      // Ignore DB write error, inMemoryKey is active
    }
  }

  return inMemoryKey;
}

/**
 * Encrypt a text string into armored format: enc:v1:<base64-iv>:<base64-ciphertext>
 * Guard: Empty or whitespace-only text is NEVER encrypted.
 */
export async function encryptText(plainText) {
  if (plainText === null || plainText === undefined) return '';
  const str = String(plainText);
  if (str.trim().length === 0) return str; // Empty string guard

  const subtle = getCryptoSubtle();
  const key = await getOrCreateVaultKey();
  const iv = getRandomValues(new Uint8Array(IV_BYTES));
  const encodedText = new TextEncoder().encode(str);

  const cipherBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    encodedText
  );

  const ivB64 = bufferToBase64(iv);
  const cipherB64 = bufferToBase64(cipherBuffer);

  return `${PREFIX}${ivB64}:${cipherB64}`;
}

/**
 * Decrypt an armored string back to plaintext.
 * Transparent Fallback: If the text does not start with enc:v1:, returns text as-is.
 */
export async function decryptText(armoredOrPlainText) {
  if (armoredOrPlainText === null || armoredOrPlainText === undefined) return '';
  const str = String(armoredOrPlainText);
  if (!str.startsWith(PREFIX)) {
    return str; // Plaintext fallback
  }

  const payload = str.slice(PREFIX.length);
  const parts = payload.split(':');
  
  let ivB64, cipherB64;
  if (parts.length === 2) {
    [ivB64, cipherB64] = parts;
  } else if (parts.length === 3) {
    // Backward compatibility for 3-part format (salt:iv:cipher)
    [, ivB64, cipherB64] = parts;
  } else {
    return str; // Malformed fallback
  }

  try {
    const subtle = getCryptoSubtle();
    const key = await getOrCreateVaultKey();
    const ivBuffer = base64ToBuffer(ivB64);
    const cipherBuffer = base64ToBuffer(cipherB64);

    const decryptedBuffer = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(ivBuffer)
      },
      key,
      cipherBuffer
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    // Fallback on key change/mismatch
    return str;
  }
}

/**
 * Check if a text is in armored encrypted format
 */
export function isEncrypted(text) {
  return typeof text === 'string' && text.startsWith(PREFIX);
}
