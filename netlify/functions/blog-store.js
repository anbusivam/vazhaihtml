// Shared blog storage — Netlify Blobs
// Provides getStore() for blog-related blob operations.
// Uses the same multi-strategy approach as auth-store.js

const path = require('path');
const fs = require('fs');

/**
 * Try to obtain a Netlify Blobs store for the 'blog' store.
 *
 * Strategy (in order):
 *
 * 1. event.blobs (connectLambda — netlify-cli 23.x Lambda compat mode).
 * 2. event.clientContext.blobs (some CLI versions).
 * 3. Library-automatic (globalThis.netlifyBlobsContext / NETLIFY_BLOBS_CONTEXT env var).
 * 4. Explicit from .netlify/state.json + NETLIFY_AUTH_TOKEN.
 * 5. SITE_ID env var (production deployments).
 */
async function getBlogStore(event) {
  const { getStore } = require('@netlify/blobs');

  // ── 1) event.blobs (connectLambda) ──────────────────────────────
  //     netlify-cli 23.x passes blob connection info via event.blobs
  //     (base64 encoded JSON with token/url). The library's connectLambda()
  //     decodes this and sets internal state so getStore() just works.
  if (event && event.blobs) {
    try {
      const { connectLambda } = require('@netlify/blobs');
      connectLambda(event);
      const store = getStore({ name: 'blog' });
      await store.get('__probe__');
      console.log('[blog-store] Using Netlify Blobs (connectLambda)');
      return store;
    } catch (err) {
      console.warn('[blog-store] connectLambda failed:', err.message);
    }
  }

  // ── 2) event.clientContext.blobs ─────────────────────────────────
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
      const store = getStore({ name: 'blog' });
      await store.get('__probe__');
      console.log('[blog-store] Using Netlify Blobs (clientContext.blobs)');
      return store;
    } catch (err) {
      console.warn('[blog-store] clientContext.blobs failed:', err.message);
    }
  }

  // ── 3) Library-automatic ────────────────────────────────────────
  //     Relies on globalThis.netlifyBlobsContext or NETLIFY_BLOBS_CONTEXT
  //     env var being set by a modern CLI version.
  try {
    const store = getStore({ name: 'blog' });
    await store.get('__probe__');
    console.log('[blog-store] Using Netlify Blobs (auto)');
    return store;
  } catch (err) {
    console.warn('[blog-store] auto failed:', err.message);
  }

  // ── 4) Explicit from .netlify/state.json + token ─────────────────
  //     Works when netlify link has been run and NETLIFY_AUTH_TOKEN is
  //     injected into the function process (e.g. via .env or the CLI).
  try {
    const statePath = path.resolve(__dirname, '../../.netlify/state.json');
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
    if (fs.existsSync(statePath) && token) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.siteId) {
        const store = getStore({ name: 'blog', siteID: state.siteId, token });
        await store.get('__probe__');
        console.log('[blog-store] Using Netlify Blobs (state.json + token)');
        return store;
      }
    }
  } catch (err) {
    console.warn('[blog-store] state.json failed:', err.message);
  }

  // ── 5) SITE_ID env var (production) ──────────────────────────────
  if (process.env.SITE_ID) {
    try {
      const store = getStore({ name: 'blog', siteID: process.env.SITE_ID });
      await store.get('__probe__');
      console.log('[blog-store] Using Netlify Blobs (SITE_ID only)');
      return store;
    } catch (err) {
      console.warn('[blog-store] SITE_ID failed:', err.message);
    }
  }

  throw new Error('Netlify Blobs (blog store) unavailable.');
}

module.exports = { getBlogStore };
