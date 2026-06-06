// Shared auth storage
// Netlify Blobs: used in production and when `siteID` + credentials are available.
// File-backed JSON: fallback for local dev (shared across all function processes).

const fs = require('fs');
const path = require('path');

// Lambda filesystem is read-only except for /tmp/.
// When running in production Netlify (Lambda), use /tmp/ for the fallback.
const LAMBDA_TMP = process.env.LAMBDA_TASK_ROOT || process.env.AWS_EXECUTION_ENV ? '/tmp' : null;
const STORE_FILE = LAMBDA_TMP
  ? path.resolve(LAMBDA_TMP, '.local-auth-store.json')
  : path.resolve(__dirname, '../../.local-auth-store.json');

// ---------------------------------------------------------------------------
// Netlify Blobs helpers
// ---------------------------------------------------------------------------

function getSiteCredentials() {
  // 1) NETLIFY_BLOBS_CONTEXT env var (full JSON string) — set by netlify dev
  const blobContext = process.env.NETLIFY_BLOBS_CONTEXT;
  if (blobContext) {
    try {
      const parsed = JSON.parse(blobContext);
      if (parsed.siteID && parsed.token) return parsed;
    } catch { /* ignore invalid JSON */ }
  }

  // 2) .netlify/state.json (set by `netlify link`) — try with NETLIFY_AUTH_TOKEN
  try {
    const statePath = path.resolve(__dirname, '../../.netlify/state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
      if (state.siteId && token) {
        return { siteID: state.siteId, token };
      }
      // Site is linked but no token available — return siteID anyway;
      // the caller will try with just the siteId for local blob emulation.
      if (state.siteId) {
        return { siteID: state.siteId, token: null };
      }
    }
  } catch { /* ignore file errors */ }

  // 3) SITE_ID env var — always set by Netlify in production deployments.
  //    No token is needed when running inside the same site's functions.
  if (process.env.SITE_ID) {
    return { siteID: process.env.SITE_ID, token: null };
  }

  return null;
}

async function tryNetlifyBlobs(context) {
  // Try with function context first (works with netlify dev)
  if (context) {
    try {
      const { getStore } = require('@netlify/blobs');
      const store = getStore({ name: 'auth', context });
      // A simple no-op to confirm the store is usable (non-existent key returns null, no throw)
      await store.get('__probe__');
      console.log('[auth-store] Using Netlify Blobs (context)');
      return store;
    } catch (err) {
      console.warn('[auth-store] Netlify Blobs (context) failed:', err.message);
    }
  }

  // Try with explicit credentials (siteID from .netlify/state.json ± token)
  const creds = getSiteCredentials();
  if (creds && creds.siteID) {
    try {
      const { getStore } = require('@netlify/blobs');
      if (creds.token) {
        const store = getStore({ name: 'auth', siteID: creds.siteID, token: creds.token });
        await store.get('__probe__');
        console.log('[auth-store] Using Netlify Blobs (explicit credentials)');
        return store;
      } else {
        // Linked site with no token — try without token for local blob emulation
        const store = getStore({ name: 'auth', siteID: creds.siteID });
        await store.get('__probe__');
        console.log('[auth-store] Using Netlify Blobs (siteID only, local emulation)');
        return store;
      }
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

// ---------------------------------------------------------------------------
// Admin user definitions — hardcoded, not changeable
// ---------------------------------------------------------------------------
const ADMIN_EMAILS = [
  'anbusivam@gmail.com',
  'vazhai.connect@gmail.com',
];

module.exports = { getStore, ADMIN_EMAILS };
