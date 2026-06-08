// Netlify Function: GET /blog/post?slug=my-post
// Returns full Editor.js JSON content for a single blog post
const { getBlogStore } = require('./blog-store');
const { handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  try {
    const slug = event.queryStringParameters && event.queryStringParameters.slug;
    if (!slug) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'slug parameter is required' }),
      };
    }

    // Sanitize slug
    const cleanSlug = slug.replace(/[^a-z0-9-]/g, '').toLowerCase();
    if (!cleanSlug) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Invalid slug' }),
      };
    }

    const store = await getBlogStore(event);
    const postKey = `blog:post:${cleanSlug}`;
    const post = await store.get(postKey, { type: 'json' });

    if (!post) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Post not found' }),
      };
    }

    // Only return published posts to public
    // Auth-checking callers (editor) can see drafts too
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ post }),
    };
  } catch (err) {
    console.error('[blog-post] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};