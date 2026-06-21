// Netlify Function: GET /blog/list
// Returns lightweight index of blog posts for public listing.
// Public users see only published posts.
// Authenticated users additionally see their own pending/draft posts.
// Admins see all posts.
const { getBlogStore } = require('./blog-store');
const { handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  try {
    const store = await getBlogStore(event);
    const authStoreModule = require('./auth-store').getStore;
    const aStore = await authStoreModule(event);

    // Determine current user from auth token (if any)
    let currentUserEmail = '';
    let currentUserRoles = [];
    try {
      const { getSession, getUserRoles } = require('./blog-auth');
      const session = await getSession(aStore, event);
      if (session) {
        currentUserEmail = session.email;
        currentUserRoles = await getUserRoles(aStore, session.email);
      }
    } catch (e) {
      // Auth check failed — treat as anonymous
    }

    const isAdmin = currentUserRoles.includes('admin');

    // Get the index entry that holds listing metadata
    const index = await store.get('blog:index', { type: 'json' }) || { posts: [] };

    // Filter:
    // - Published posts are always shown
    // - Admins see all posts
    // - Non-admin users see their own non-published posts too
    const visible = index.posts.filter(p => {
      if (p.status === 'published') return true;
      if (isAdmin) return true;
      if (currentUserEmail && p.author === currentUserEmail) return true;
      return false;
    });

    // Sort by publish date (or created date) descending
    visible.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));

    // Enrich posts with author display names
    const nameCache = {};
    for (const post of visible) {
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
      body: JSON.stringify({ posts: visible }),
    };
  } catch (err) {
    console.error('[blog-list] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};
