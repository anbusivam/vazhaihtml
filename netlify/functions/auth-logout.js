// Netlify Function: POST /auth/logout
// Deletes the session from local store and clears the cookie
const { getStore } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const cookies = event.headers['cookie'] || '';
    const authHeader = event.headers['authorization'] || '';

    let token = null;
    const match = cookies.match(/vazhai_session=([^;]+)/);
    if (match) token = match[1];
    if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);

    if (token) {
      const store = await getStore(event);
      await store.delete(`session:${token}`);
    }

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Set-Cookie': 'vazhai_session=; Path=/; Max-Age=0; SameSite=Lax',
      },
      body: JSON.stringify({ success: true, message: 'Logged out successfully.' }),
    };
  } catch (err) {
    console.error('[auth-logout] Exception:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
};