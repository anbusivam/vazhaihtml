// Netlify Function: POST /blog/approve
// Approves a pending post (sets status from 'pending' to 'published').
// Also supports rejecting (setting back to 'draft') or approving a draft.
// Only admins can approve/reject posts.
const { getBlogStore } = require('./blog-store');
const { requireBloggerOrAdmin, handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Authenticate — must be admin
    const authStore = require('./auth-store').getStore;
    const aStore = await authStore(event);
    const auth = await requireBloggerOrAdmin(aStore, event);
    if (!auth.authorized) {
      return { statusCode: auth.status, headers: CORS_HEADERS, body: JSON.stringify({ error: auth.error }) };
    }

    if (!auth.roles.includes('admin')) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Only admins can approve posts.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { slug, action } = body;

    if (!slug) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Slug is required' }) };
    }
    if (!action || !['approve', 'reject'].includes(action)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Action must be "approve" or "reject"' }) };
    }

    const store = await getBlogStore(event);
    const post = await store.get(`blog:post:${slug}`, { type: 'json' });

    if (!post) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Post not found' }) };
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      post.status = 'published';
      post.publishedAt = post.publishedAt || now;
      post.updatedAt = now;
    } else {
      // Reject: set back to draft
      post.status = 'draft';
      post.updatedAt = now;
    }

    // Save updated post
    await store.setJSON(`blog:post:${slug}`, post);

    // Update index
    const index = await store.get('blog:index', { type: 'json' }) || { posts: [] };
    const existingIdx = index.posts.findIndex(p => p.slug === slug);
    if (existingIdx >= 0) {
      index.posts[existingIdx].status = post.status;
      index.posts[existingIdx].publishedAt = post.publishedAt;
      index.posts[existingIdx].updatedAt = now;
    }
    await store.setJSON('blog:index', index);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        slug: post.slug,
        status: post.status,
        message: action === 'approve' ? 'Post approved and published.' : 'Post rejected and moved to drafts.',
      }),
    };
  } catch (err) {
    console.error('[blog-approve] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};