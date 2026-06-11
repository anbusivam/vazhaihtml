// Netlify Function: /blog/comment
// POST   — submit a comment (requires auth)
// GET    — list comments for a post slug
const { getBlogStore } = require('./blog-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const store = await getBlogStore(event);

    if (event.httpMethod === 'GET') {
      // GET /blog/comment?slug=xxx  — retrieve comments for a post
      const params = new URLSearchParams(event.queryStringParameters || {});
      const slug = params.get('slug');
      if (!slug) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing slug parameter' }),
        };
      }

      const comments = await getComments(store, slug);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ comments }),
      };
    }

    if (event.httpMethod === 'POST') {
      // POST /blog/comment  — submit a comment (requires authentication)
      const authHeader = event.headers['authorization'] || '';
      const cookies = event.headers['cookie'] || '';

      let token = null;
      const match = cookies.match(/vazhai_session=([^;]+)/);
      if (match) token = match[1];
      if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);

      if (!token) {
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Authentication required' }),
        };
      }

      // Validate session via auth-store
      const { getStore, ADMIN_EMAILS } = require('./auth-store');
      const authStore = await getStore(event);
      const session = await authStore.get(`session:${token}`, { type: 'json' });

      if (!session || Date.now() > session.expiresAt) {
        if (session) await authStore.delete(`session:${token}`);
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Session expired. Please log in again.' }),
        };
      }

      // Parse request body
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Invalid JSON body' }),
        };
      }

      const slug = (body.slug || '').trim();
      const text = (body.text || '').trim();

      if (!slug || !text) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing slug or text' }),
        };
      }

      if (text.length > 2000) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Comment too long (max 2000 characters)' }),
        };
      }

      // Get user display name
      const userData = await authStore.get(`user:${session.email}`, { type: 'json' });
      const userName = (userData && userData.name) || session.email.split('@')[0];

      // Create comment
      const id = Date.now().toString() + '-' + Math.random().toString(36).slice(2, 6);
      const comment = {
        id,
        slug,
        email: session.email,
        name: userName,
        text,
        createdAt: new Date().toISOString(),
      };

      // Store comment in blobs
      await store.setJSON(`blog:comment:${slug}:${id}`, comment);

      // Append to comment index for this slug
      const indexKey = `blog:comments:${slug}`;
      const existingIndex = await store.get(indexKey, { type: 'json' });
      const indexList = Array.isArray(existingIndex) ? existingIndex : [];
      indexList.push(id);
      await store.setJSON(indexKey, indexList);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ comment, ok: true }),
      };
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (err) {
    console.error('[blog-comment] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};

async function getComments(store, slug) {
  try {
    const indexKey = `blog:comments:${slug}`;
    const indexList = await store.get(indexKey, { type: 'json' });
    if (!Array.isArray(indexList) || indexList.length === 0) {
      return [];
    }

    const comments = [];
    for (const id of indexList) {
      const comment = await store.get(`blog:comment:${slug}:${id}`, { type: 'json' });
      if (comment) {
        comments.push(comment);
      }
    }
    return comments;
  } catch (err) {
    console.error('[blog-comment] getComments error:', err.message);
    return [];
  }
}