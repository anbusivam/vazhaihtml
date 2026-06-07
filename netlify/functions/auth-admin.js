// Netlify Function: GET/POST /auth/admin
// Admin-only: list users, add user, set user role
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VALID_ROLES = ['admin', 'volunteer', 'donor', 'blogger'];

// Extract session from request
async function getSession(store, event) {
  const cookies = event.headers['cookie'] || '';
  const authHeader = event.headers['authorization'] || '';

  let token = null;
  const match = cookies.match(/vazhai_session=([^;]+)/);
  if (match) token = match[1];
  if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token) return null;

  const session = await store.get(`session:${token}`, { type: 'json' });
  if (!session || Date.now() > session.expiresAt) return null;

  return session;
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);

    // Must be authenticated
    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // Must be an admin
    if (!ADMIN_EMAILS.includes(session.email)) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    }

    // GET: list all users
    if (event.httpMethod === 'GET') {
      // We need to iterate all user: keys - blobs doesn't support listing natively,
      // so we use a separate "users:list" key to track registered emails
      const usersList = await store.get('users:list', { type: 'json' }) || [];
      const users = [];

      for (const email of usersList) {
        const userData = await store.get(`user:${email}`, { type: 'json' });
        if (userData) {
          users.push(userData);
        }
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ users }),
      };
    }

    // POST: set roles or add user
    if (event.httpMethod === 'POST') {
      const { action, email: targetEmail, roles, role } = JSON.parse(event.body || '{}');

      if (!targetEmail) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Email is required.' }) };
      }

      const normalizedEmail = targetEmail.toLowerCase().trim();

      // Cannot change admin emails
      if (ADMIN_EMAILS.includes(normalizedEmail)) {
        return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cannot modify admin users.' }) };
      }

      if (action === 'set-roles') {
        // roles must be an array of valid role strings
        if (!Array.isArray(roles)) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Roles must be an array.' }) };
        }
        for (const r of roles) {
          if (!VALID_ROLES.includes(r)) {
            return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Invalid role "${r}". Valid roles: ${VALID_ROLES.join(', ')}` }) };
          }
        }

        const userData = await store.get(`user:${normalizedEmail}`, { type: 'json' });
        if (!userData) {
          return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User not found.' }) };
        }

        userData.roles = roles;
        userData.lastUpdated = new Date().toISOString();
        await store.setJSON(`user:${normalizedEmail}`, userData);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, user: userData, message: `Roles updated for ${normalizedEmail}.` }),
        };
      }

      if (action === 'add-user') {
        // Check if user already exists
        const existing = await store.get(`user:${normalizedEmail}`, { type: 'json' });
        if (existing) {
          return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User already exists.' }) };
        }

        const newUser = {
          email: normalizedEmail,
          roles: [],
          role: null, // kept for backward compat
          firstLogin: null,
          lastLogin: null,
          addedBy: session.email,
          addedAt: new Date().toISOString(),
        };

        await store.setJSON(`user:${normalizedEmail}`, newUser);

        // Add to users list
        const usersList = await store.get('users:list', { type: 'json' }) || [];
        if (!usersList.includes(normalizedEmail)) {
          usersList.push(normalizedEmail);
          await store.setJSON('users:list', usersList);
        }

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, user: newUser, message: `User ${normalizedEmail} added.` }),
        };
      }

      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action. Use "set-role" or "add-user".' }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('[auth-admin] Exception:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
};