// Netlify Function: GET /auth/check
// Validates the session cookie stored locally
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const cookies = event.headers['cookie'] || '';
    const authHeader = event.headers['authorization'] || '';

    let token = null;

    const match = cookies.match(/vazhai_session=([^;]+)/);
    if (match) token = match[1];
    if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);

    if (!token) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ authenticated: false }) };
    }

    const store = await getStore(event);
    const session = await store.get(`session:${token}`, { type: 'json' });

    if (!session) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ authenticated: false }) };
    }

    if (Date.now() > session.expiresAt) {
      await store.delete(`session:${token}`);
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Set-Cookie': 'vazhai_session=; Path=/; Max-Age=0; SameSite=Lax' },
        body: JSON.stringify({ authenticated: false }),
      };
    }

    // Fetch user data to get roles
    // Hardcoded ADMIN_EMAILS takes precedence so admins always get their role
    // regardless of when their user record was created
    const userData = await store.get(`user:${session.email}`, { type: 'json' });
    let roles = [];
    let userName = '';
    let userPhone = '';
    let userPan = '';
    let userAddress = '';
    if (userData) {
      // Support both old single-role format and new array format
      if (Array.isArray(userData.roles)) {
        roles = userData.roles;
      } else if (userData.role) {
        roles = [userData.role];
      }
      userName = userData.name || '';
      userPhone = userData.phone || '';
      userPan = userData.pan || '';
      userAddress = userData.address || '';
    }
    // Hardcoded admin emails always get 'admin' role
    if (ADMIN_EMAILS.includes(session.email) && !roles.includes('admin')) {
      roles = [...roles, 'admin'];
    }
    // Store a display-friendly role string for backward compat with existing frontend
    const primaryRole = roles.length > 0 ? roles[0] : null;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        authenticated: true, 
        email: session.email, 
        name: userName,
        phone: userPhone,
        pan: userPan,
        address: userAddress,
        expiresAt: session.expiresAt,
        roles: roles,
        role: primaryRole
      }),
    };
  } catch (err) {
    console.error('[auth-check] Exception:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
};