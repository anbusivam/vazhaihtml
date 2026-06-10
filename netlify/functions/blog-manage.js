// Netlify Function: GET /blog/manage
// Returns all posts the authenticated user is allowed to see.
// All authenticated users see their own posts (all statuses).
// Admins see ALL posts (draft, pending, published).
const { getBlogStore } = require('./blog-store');
const { requireAnyAuthenticated, handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  try {
    // Authenticate — any logged-in user can manage their posts
    const authStore = require('./auth-store').getStore;
    const aStore = await authStore(event);
    const auth = await requireAnyAuthenticated(aStore, event);
    if (!auth.authorized) {
      return { statusCode: auth.status, headers: CORS_HEADERS, body: JSON.stringify({ error: auth.error }) };
    }

    const store = await getBlogStore(event);
    const index = await store.get('blog:index', { type: 'json' }) || { posts: [] };

    let posts = index.posts;

    // Filter: non-admins see only their own posts, admins see all
    if (!auth.roles.includes('admin')) {
      posts = posts.filter(p => p.author === auth.email);
    }

    // Sort by updatedAt descending
    posts.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    // Enrich posts with author display names
    const nameCache = {};
    for (const post of posts) {
      if (!nameCache[post.author]) {
        try {
          const userData = await aStore.get(`user:${post.author}`, { type: 'json' });
          nameCache[post.author] = (userData && userData.name) ? userData.name : post.author;
        } catch {
          nameCache[post.author] = post.author;
        }
      }
      post.authorName = nameCache[post.author];
    }

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
