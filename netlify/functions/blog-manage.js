// Netlify Function: GET /blog/manage
// Returns all posts (drafts + published) for the authenticated blogger/admin.
// Bloggers see only their own posts. Admins see all posts.
const { getBlogStore } = require('./blog-store');
const { requireBloggerOrAdmin, handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  try {
    // Authenticate
    const authStore = require('./auth-store').getStore;
    const aStore = await authStore(event);
    const auth = await requireBloggerOrAdmin(aStore, event);
    if (!auth.authorized) {
      return { statusCode: auth.status, headers: CORS_HEADERS, body: JSON.stringify({ error: auth.error }) };
    }

    const store = await getBlogStore(event);
    const index = await store.get('blog:index', { type: 'json' }) || { posts: [] };

    let posts = index.posts;

    // Filter: bloggers see only their own posts, admins see all
    if (!auth.roles.includes('admin')) {
      posts = posts.filter(p => p.author === auth.email);
    }

    // Sort by updatedAt descending
    posts.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ posts }),
    };
  } catch (err) {
    console.error('[blog-manage] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};