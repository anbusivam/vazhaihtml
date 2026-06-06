// Shared auth storage
// Netlify Blobs: used in production and when `siteID` + credentials are available.
// File-backed JSON: fallback for local dev (shared across all function processes).

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.resolve(__dirname, '../../.local-auth-store.json');

// ---------------------------------------------------------------------------
// Netlify Blobs helpers
// ---------------------------------------------------------------------------

function getSiteCredentials() {
  // 1) NETLIFY_BLOBS_CONTEXT env var (full JSON string)
  const blobContext = process.env.NETLIFY_BLOBS_CONTEXT;
  if (blobContext) {
    try {
      const parsed = JSON.parse(blobContext);
      if (parsed.siteID && parsed.token) return parsed;
    } catch { /* ignore invalid JSON */ }
  }

  // 2) .netlify/state.json + NETLIFY_AUTH_TOKEN
  try {
    const statePath = path.resolve(__dirname, '../../.netlify/state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
      if (state.siteId && token) {
        return { siteID: state.siteId, token };
      }
    }
  } catch { /* ignore file errors */ }

  return null;
}

async function tryNetlifyBlobs(context) {
  // Try with function context first
  if (context) {
    try {
      const { getStore } = require('@netlify/blobs');
      const store = getStore({ name: 'auth', context });
      await store.get('__probe__');
      return store;
    } catch { /* fall through */ }
  }

  // Try with explicit credentials
  const creds = getSiteCredentials();
  if (creds) {
    try {
      const { getStore } = require('@netlify/blobs');
      const store = getStore({ name: 'auth', siteID: creds.siteID, token: creds.token });
      await store.get('__probe__');
      return store;
    } catch (err) {
      console.warn('[auth-store] Netlify Blobs (explicit creds) failed:', err.message);
    }
  } else {
    console.log('[auth-store] No Netlify Blobs credentials found, using file-backed store');
  }

  return null;
}

// ---------------------------------------------------------------------------
// File-backed store (local dev fallback)
// ---------------------------------------------------------------------------

function loadFileStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      return new Map(Object.entries(JSON.parse(raw)));
    }
  } catch (err) {
    console.error('[auth-store] Failed to load store file, starting fresh:', err.message);
  }
  return new Map();
}

function persistFileStore(store) {
  try {
    const obj = Object.fromEntries(store);
    fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[auth-store] Failed to persist store file:', err.message);
  }
}

function makeFileStore() {
  const store = loadFileStore();

  // Prune expired sessions on load
  let changed = false;
  for (const [key, val] of store) {
    if (key.startsWith('session:') && val && val.expiresAt && Date.now() > val.expiresAt) {
      store.delete(key);
      changed = true;
    }
  }
  if (changed) persistFileStore(store);

  return {
    get: async (key, opts) => {
      const val = store.get(key);
      if (val === undefined) return null;
      if (opts && opts.type === 'json') return val;
      return String(val);
    },
    getAsText: async (key) => {
      const val = store.get(key);
      return val !== undefined ? JSON.stringify(val) : null;
    },
    set: async (key, value) => { store.set(key, value); persistFileStore(store); },
    setJSON: async (key, value) => { store.set(key, value); persistFileStore(store); },
    delete: async (key) => { store.delete(key); persistFileStore(store); },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function getStore(context) {
  const blobs = await tryNetlifyBlobs(context);
  if (blobs) return blobs;

  // Fallback: file-backed JSON store (shared across all function processes)
  return makeFileStore();
}

module.exports = { getStore };