// Netlify Function: GET /blog/list
// Returns lightweight index of blog posts for public listing (published only)
const { getBlogStore } = require('./blog-store');
const { handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  try {
    const store = await getBlogStore(event);

    // Get the index entry that holds listing metadata
    const index = await store.get('blog:index', { type: 'json' }) || { posts: [] };

    // Filter to published only for public view
    const published = index.posts.filter(p => p.status === 'published');

    // Sort by publish date descending
    published.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ posts: published }),
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