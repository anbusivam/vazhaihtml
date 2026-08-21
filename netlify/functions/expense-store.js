// Shared expense storage — Netlify Blobs
// Provides getExpenseStore() for expense blob operations.
// Uses the same multi-strategy approach as auth-store.js and bank-store.js

const path = require('path');
const fs = require('fs');

/**
 * Try to obtain a Netlify Blobs store for the 'expense' store.
 *
 * Strategy (in order):
 *
 * 1. event.blobs (connectLambda — netlify-cli 23.x Lambda compat mode).
 * 2. event.clientContext.blobs (some CLI versions).
 * 3. Library-automatic (globalThis.netlifyBlobsContext / NETLIFY_BLOBS_CONTEXT env var).
 * 4. Explicit from .netlify/state.json + NETLIFY_AUTH_TOKEN.
 * 5. SITE_ID env var (production deployments).
 */
async function getExpenseStore(event) {
  const { getStore } = require('@netlify/blobs');

  // ── 1) event.blobs (connectLambda) ──────────────────────────────
  if (event && event.blobs) {
    try {
      const { connectLambda } = require('@netlify/blobs');
      connectLambda(event);
      const store = getStore({ name: 'expense' });
      await store.get('__probe__');
      console.log('[expense-store] Using Netlify Blobs (connectLambda)');
      return store;
    } catch (err) {
      console.warn('[expense-store] connectLambda failed:', err.message);
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
      const store = getStore({ name: 'expense' });
      await store.get('__probe__');
      console.log('[expense-store] Using Netlify Blobs (clientContext.blobs)');
      return store;
    } catch (err) {
      console.warn('[expense-store] clientContext.blobs failed:', err.message);
    }
  }

  // ── 3) Library-automatic ────────────────────────────────────────
  try {
    const store = getStore({ name: 'expense' });
    await store.get('__probe__');
    console.log('[expense-store] Using Netlify Blobs (auto)');
    return store;
  } catch (err) {
    console.warn('[expense-store] auto failed:', err.message);
  }

  // ── 4) Explicit from .netlify/state.json + token ─────────────────
  try {
    const statePath = path.resolve(__dirname, '../../.netlify/state.json');
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
    if (fs.existsSync(statePath) && token) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.siteId) {
        const store = getStore({ name: 'expense', siteID: state.siteId, token });
        await store.get('__probe__');
        console.log('[expense-store] Using Netlify Blobs (state.json + token)');
        return store;
      }
    }
  } catch (err) {
    console.warn('[expense-store] state.json failed:', err.message);
  }

  // ── 5) SITE_ID env var (production) ──────────────────────────────
  if (process.env.SITE_ID) {
    try {
      const store = getStore({ name: 'expense', siteID: process.env.SITE_ID });
      await store.get('__probe__');
      console.log('[expense-store] Using Netlify Blobs (SITE_ID only)');
      return store;
    } catch (err) {
      console.warn('[expense-store] SITE_ID failed:', err.message);
    }
  }

  throw new Error('Netlify Blobs (expense store) unavailable.');
}

module.exports = { getExpenseStore };