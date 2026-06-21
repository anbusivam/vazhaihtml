// Netlify Function: POST /blog/delete
// Deletes a blog post. Requires the user to be the author or an admin.
// Removes the full post data and the index entry.
const { getBlogStore } = require('./blog-store');
const { requireAnyAuthenticated, handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Authenticate — any logged-in user can attempt to delete their own posts
    const authStore = require('./auth-store').getStore;
    const aStore = await authStore(event);
    const auth = await requireAnyAuthenticated(aStore, event);
    if (!auth.authorized) {
      return { statusCode: auth.status, headers: CORS_HEADERS, body: JSON.stringify({ error: auth.error }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { slug } = body;

    if (!slug || !slug.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Slug is required' }) };
    }

    const cleanSlug = slug.replace(/[^a-z0-9-]/g, '').toLowerCase();
    if (!cleanSlug) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid slug' }) };
    }

    const store = await getBlogStore(event);

    // Fetch the post to verify ownership
    const post = await store.get(`blog:post:${cleanSlug}`, { type: 'json' });
    if (!post) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Post not found' }) };
    }

    // Check authorization: admin can delete any post, author can delete their own
    const isAdmin = auth.roles.includes('admin');
    const isOwner = post.author === auth.email;
    if (!isAdmin && !isOwner) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'You can only delete your own posts.' }) };
    }

    // Delete the full post data
    await store.delete(`blog:post:${cleanSlug}`);

    // Remove from the index
    const index = await store.get('blog:index', { type: 'json' }) || { posts: [] };
    const existingIdx = index.posts.findIndex(p => p.slug === cleanSlug);
    if (existingIdx >= 0) {
      index.posts.splice(existingIdx, 1);
      await store.setJSON('blog:index', index);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, message: 'Post deleted.' }),
    };
  } catch (err) {
    console.error('[blog-delete] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};