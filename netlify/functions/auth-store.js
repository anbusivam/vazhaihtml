// Shared auth storage
// On Netlify: uses Netlify Blobs
// Locally: uses a JSON file on disk (survives server restarts)

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.resolve(__dirname, '../../.local-auth-store.json');

// In-memory cache loaded from disk on first access
let localStore = null;

function loadStore() {
  if (localStore) return localStore;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      localStore = new Map(Object.entries(JSON.parse(raw)));
    } else {
      localStore = new Map();
    }
  } catch (err) {
    console.error('[auth-store] Failed to load store file, starting fresh:', err.message);
    localStore = new Map();
  }
  return localStore;
}

function persistStore() {
  try {
    const obj = Object.fromEntries(localStore);
    fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[auth-store] Failed to persist store file:', err.message);
  }
}

// Clean expired sessions on load
function pruneExpired() {
  const store = loadStore();
  let changed = false;
  for (const [key, val] of store) {
    if (key.startsWith('session:') && val && val.expiresAt && Date.now() > val.expiresAt) {
      store.delete(key);
      changed = true;
    }
  }
  if (changed) persistStore();
}

// Prune expired entries on module load
pruneExpired();

// Detect if running on actual Netlify deployment (not local dev)
function isNetlify() {
  return (process.env.NETLIFY === 'true' && process.env.NETLIFY_DEV !== 'true') ||
         (process.env.DEPLOY_PRIME_URL && process.env.NETLIFY_DEV !== 'true') ||
         (process.env.DEPLOY_URL && process.env.NETLIFY_DEV !== 'true');
}

async function getStore(context) {
  if (isNetlify()) {
    const { getStore } = require('@netlify/blobs');
    return getStore({ name: 'auth', context });
  }
  // Local: return a mock store that wraps the file-backed Map
  const store = loadStore();
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
    set: async (key, value) => { store.set(key, value); persistStore(); },
    setJSON: async (key, value) => { store.set(key, value); persistStore(); },
    delete: async (key) => { store.delete(key); persistStore(); },
  };
}

module.exports = { getStore };
