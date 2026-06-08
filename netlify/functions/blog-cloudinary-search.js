// Netlify Function: POST /blog/cloudinary-search
// Lists/searchs images from the Cloudinary account using Admin API (authenticated with API Key + Secret)
const { handleOptions, CORS_HEADERS } = require('./blog-auth');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || '';
const CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || '';

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_KEY || !CLOUDINARY_SECRET) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Cloudinary not configured.' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { search, cursor } = body;
    
    // Build the Admin API request to list/search images
    // We use Basic Auth with API Key and Secret
    const auth = Buffer.from(`${CLOUDINARY_KEY}:${CLOUDINARY_SECRET}`).toString('base64');
    
    // Cloudinary Admin API: /resources/image for listing, or /resources/search for full-text search
    let apiUrl;
    let methodBody;

    if (search && search.trim()) {
      // Use the search API for full-text searching
      apiUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/search`;
      methodBody = JSON.stringify({
        expression: search.trim(),
        max_results: 50,
        next_cursor: cursor || undefined,
      });
    } else {
      // Use resources/list for simple listing
      // If cursor is provided, get next page
      let listUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image?max_results=50`;
      if (cursor) {
        listUrl += `&next_cursor=${encodeURIComponent(cursor)}`;
      }
      apiUrl = listUrl;
    }

    let cloudinaryRes;
    if (search && search.trim()) {
      cloudinaryRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: methodBody,
      });
    } else {
      cloudinaryRes = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });
    }

    if (!cloudinaryRes.ok) {
      const errText = await cloudinaryRes.text();
      console.error('[blog-cloudinary-search] Cloudinary error:', cloudinaryRes.status, errText);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Cloudinary search failed' }),
      };
    }

    const cloudinaryData = await cloudinaryRes.json();

    // Map Cloudinary response to a simpler format
    const images = (cloudinaryData.resources || []).map(r => ({
      publicId: r.public_id,
      url: r.secure_url || r.url,
      thumbnail: r.secure_url ? r.secure_url.replace('/upload/', '/upload/w_200,h_150,c_fill/') : (r.url || ''),
      width: r.width,
      height: r.height,
      format: r.format,
      bytes: r.bytes,
      createdAt: r.created_at,
      folder: r.folder,
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        images,
        nextCursor: cloudinaryData.next_cursor || null,
        totalCount: cloudinaryData.total_count || cloudinaryData.resources?.length || 0,
      }),
    };
  } catch (err) {
    console.error('[blog-cloudinary-search] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};