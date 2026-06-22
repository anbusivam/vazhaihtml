// Netlify Function: POST /auth/update-profile
// Allows authenticated users to update their name and phone number.
const { getStore } = require('./auth-store');
const { getSession, getUserRoles } = require('./blog-auth');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);

    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const { name, phone, pan, address } = JSON.parse(event.body || '{}');

    // Name is mandatory
    if (!name || !name.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Name is required.' }) };
    }

    const normalizedEmail = session.email;
    const userData = await store.get(`user:${normalizedEmail}`, { type: 'json' });

    if (!userData) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User not found.' }) };
    }

    // Update fields
    userData.name = name.trim();
    if (phone !== undefined) {
      userData.phone = phone.trim();
    }
    if (pan !== undefined) {
      userData.pan = pan.trim().toUpperCase();
    }
    if (address !== undefined) {
      userData.address = address.trim();
    }
    userData.lastUpdated = new Date().toISOString();

    await store.setJSON(`user:${normalizedEmail}`, userData);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        message: 'Profile updated successfully.',
        name: userData.name,
        phone: userData.phone,
        pan: userData.pan || '',
        address: userData.address || '',
      }),
    };
  } catch (err) {
    console.error('[auth-update-profile] Exception:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
};