// Shared volunteer application storage using Netlify Blobs.
const path = require('path');
const fs = require('fs');

async function getVolunteerStore(event) {
  const { getStore } = require('@netlify/blobs');

  if (event && event.blobs) {
    try {
      const { connectLambda } = require('@netlify/blobs');
      connectLambda(event);
      const store = getStore({ name: 'volunteer' });
      await store.get('__probe__');
      return store;
    } catch (err) {
      console.warn('[volunteer-store] connectLambda failed:', err.message);
    }
  }

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
      const store = getStore({ name: 'volunteer' });
      await store.get('__probe__');
      return store;
    } catch (err) {
      console.warn('[volunteer-store] clientContext.blobs failed:', err.message);
    }
  }

  try {
    const store = getStore({ name: 'volunteer' });
    await store.get('__probe__');
    return store;
  } catch (err) {
    console.warn('[volunteer-store] automatic discovery failed:', err.message);
  }

  try {
    const statePath = path.resolve(__dirname, '../../.netlify/state.json');
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
    if (fs.existsSync(statePath) && token) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.siteId) {
        const store = getStore({ name: 'volunteer', siteID: state.siteId, token });
        await store.get('__probe__');
        return store;
      }
    }
  } catch (err) {
    console.warn('[volunteer-store] state.json discovery failed:', err.message);
  }

  if (process.env.SITE_ID) {
    const store = getStore({ name: 'volunteer', siteID: process.env.SITE_ID });
    await store.get('__probe__');
    return store;
  }

  throw new Error('Netlify Blobs (volunteer store) unavailable.');
}

module.exports = { getVolunteerStore };
