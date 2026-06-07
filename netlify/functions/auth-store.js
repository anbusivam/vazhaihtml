// Shared auth storage
// Netlify Blobs: used in both production and local dev (via `netlify link` + `netlify dev`).
// No file-backed fallback — if blobs are unavailable, an error is thrown.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers to connect to the local blob server started by netlify dev
//
// netlify-cli 23.x runs functions in Lambda compatibility mode and does NOT
// inject NETLIFY_BLOBS_CONTEXT into the process.  Instead the CLI starts a
// local blob server and passes the connection info (token + URL) inside the
// function event's clientContext.blobs field.
//
// In contrast, newer CLI versions (or production deploys) either set the
// NETLIFY_BLOBS_CONTEXT env var or rely on the @netlify/blobs library's
// built-in environment detection.
// ---------------------------------------------------------------------------

/**
 * Try to obtain a Netlify Blobs store.
 *
 * Strategy (in order):
 *
 * 1. If we're inside a Netlify Functions invocation (event?.clientContext?.blobs),
 *    use connectLambda() to decode the blob context and then auto-resolve.
 *
 * 2. Library-automatic: let @netlify/blobs discover credentials from:
 *      - globalThis.netlifyBlobsContext
 *      - NETLIFY_BLOBS_CONTEXT (base64-encoded env var)
 *
 * 3. Explicit from .netlify/state.json + NETLIFY_AUTH_TOKEN / NETLIFY_ACCESS_TOKEN
 *    (works when NETLIFY_AUTH_TOKEN is injected into the function process).
 *
 * 4. SITE_ID env var (set by Netlify in production deployments — may fail if
 *    the library needs a token for the API path).
 */
async function tryNetlifyBlobs(event) {
  const { getStore, setEnvironmentContext } = require('@netlify/blobs');

  // ── 1) event.blobs (Lambda compat mode, netlify-cli 23.x) ─────────
  //     The old CLI passes blob connection info via event.blobs (base64
  //     encoded JSON with token/url) and headers (x-nf-site-id, etc.).
  //     The @netlify/blobs library's connectLambda() decodes this.
  if (event && event.blobs) {
    try {
      const { connectLambda } = require('@netlify/blobs');
      connectLambda(event);
      const store = getStore({ name: 'auth' });
      await store.get('__probe__');
      console.log('[auth-store] Using Netlify Blobs (connectLambda)');
      return store;
    } catch (err) {
      console.warn('[auth-store] Netlify Blobs (connectLambda) failed:', err.message);
    }
  }
  // Also check clientContext.blobs (some CLI versions/event-formats)
  if (event && event.clientContext && event.clientContext.blobs) {
    try {
      const { setEnvironmentContext } = require('@netlify/blobs');
      const raw = Buffer.from(event.clientContext.blobs, 'base64').toString('utf-8');
      const blobInfo = JSON.parse(raw);
      setEnvironmentContext({
        siteID: event.headers['x-nf-site-id'] || process.env.SITE_ID,
        token: blobInfo.token,
        edgeURL: blobInfo.url,
        deployID: event.headers['x-nf-deploy-id'],
      });
      const store = getStore({ name: 'auth' });
      await store.get('__probe__');
      console.log('[auth-store] Using Netlify Blobs (clientContext.blobs)');
      return store;
    } catch (err) {
      console.warn('[auth-store] Netlify Blobs (clientContext.blobs) failed:', err.message);
    }
  }

  // ── 2) Library-automatic (modern CLI / env var) ────────────────
  try {
    const store = getStore({ name: 'auth' });
    await store.get('__probe__');
    console.log('[auth-store] Using Netlify Blobs (auto)');
    return store;
  } catch (err) {
    console.warn('[auth-store] Netlify Blobs (auto) failed:', err.message);
  }

  // ── 3) Explicit from .netlify/state.json + token ───────────────
  try {
    const statePath = path.resolve(__dirname, '../../.netlify/state.json');
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
    if (fs.existsSync(statePath) && token) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.siteId) {
        const store = getStore({ name: 'auth', siteID: state.siteId, token });
        await store.get('__probe__');
        console.log('[auth-store] Using Netlify Blobs (state.json + token)');
        return store;
      }
    }
  } catch (err) {
    console.warn('[auth-store] Netlify Blobs (state.json) failed:', err.message);
  }

  // ── 4) SITE_ID env var (production — works when deployed) ──────
  if (process.env.SITE_ID) {
    try {
      const store = getStore({ name: 'auth', siteID: process.env.SITE_ID });
      await store.get('__probe__');
      console.log('[auth-store] Using Netlify Blobs (SITE_ID only)');
      return store;
    } catch (err) {
      console.warn('[auth-store] Netlify Blobs (SITE_ID) failed:', err.message);
    }
  }

  console.log('[auth-store] No Netlify Blobs credentials found');
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Obtain the 'auth' store.
 *
 * @param {object} [event] – Netlify Functions event object. When running via
 *   `netlify dev`, this carries clientContext.blobs from the local blob server.
 */
async function getStore(event) {
  const blobs = await tryNetlifyBlobs(event);
  if (blobs) return blobs;

  throw new Error(
    'Netlify Blobs is unavailable. ' +
    'Ensure the site is linked (netlify link) and running via netlify dev, ' +
    'or that SITE_ID is set in the deployment environment.'
  );
}

// ---------------------------------------------------------------------------
// Admin user definitions — hardcoded, not changeable
// ---------------------------------------------------------------------------
const ADMIN_EMAILS = [
  'anbusivam@gmail.com',
  'vazhai.connect@gmail.com',
];

module.exports = { getStore, ADMIN_EMAILS };