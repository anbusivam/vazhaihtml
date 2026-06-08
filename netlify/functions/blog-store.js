// Shared blog storage — Netlify Blobs
// Provides getStore() for blog-related blob operations

const { getStore: getBlobStore } = require('@netlify/blobs');

async function getBlogStore(event) {
  // Try to connect to blobs the same way auth-store does
  try {
    // If running via netlify dev with blobs context
    if (event && event.clientContext && event.clientContext.blobs) {
      const { setEnvironmentContext } = require('@netlify/blobs');
      const raw = Buffer.from(event.clientContext.blobs, 'base64').toString('utf-8');
      const blobInfo = JSON.parse(raw);
      setEnvironmentContext({
        siteID: event.headers['x-nf-site-id'] || process.env.SITE_ID,
        token: blobInfo.token,
        edgeURL: blobInfo.url,
        deployID: event.headers['x-nf-deploy-id'],
      });
      const store = getBlobStore({ name: 'blog' });
      await store.get('__probe__');
      return store;
    }
  } catch (err) {
    console.warn('[blog-store] clientContext.blobs failed:', err.message);
  }

  // Library-automatic
  try {
    const store = getBlobStore({ name: 'blog' });
    await store.get('__probe__');
    return store;
  } catch (err) {
    console.warn('[blog-store] auto failed:', err.message);
  }

  // SITE_ID
  if (process.env.SITE_ID) {
    try {
      const store = getBlobStore({ name: 'blog', siteID: process.env.SITE_ID });
      await store.get('__probe__');
      return store;
    } catch (err) {
      console.warn('[blog-store] SITE_ID failed:', err.message);
    }
  }

  throw new Error('Netlify Blobs (blog store) unavailable.');
}

module.exports = { getBlogStore };