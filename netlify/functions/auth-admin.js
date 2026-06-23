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

      if (action !== 'bulk-update') {
        if (!targetEmail) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Email is required.' }) };
        }
      }

      const normalizedEmail = targetEmail ? targetEmail.toLowerCase().trim() : '';

      // Cannot change admin emails
      if (normalizedEmail && ADMIN_EMAILS.includes(normalizedEmail)) {
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

      if (action === 'bulk-update') {
        // users is an array of { email, name, phone, pan, address, tamilName, notes, roles }
        const { users } = JSON.parse(event.body || '{}');
        if (!Array.isArray(users) || users.length === 0) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Users array is required and must not be empty.' }) };
        }

        const results = { updated: [], errors: [] };

        for (const u of users) {
          const userEmail = u.email.toLowerCase().trim();
          const isTargetAdmin = ADMIN_EMAILS.includes(userEmail);
          const isRequesterAdmin = ADMIN_EMAILS.includes(session.email);

          // System admin users: only editable by the system admin themselves,
          // and only for profile fields (name, phone, pan, address, tamilName, notes),
          // NOT for roles or email.
          if (isTargetAdmin) {
            if (!isRequesterAdmin) {
              results.errors.push({ email: userEmail, error: 'Cannot modify admin users.' });
              continue;
            }

            // System admin editing own profile — load current data
            const userData = await store.get(`user:${userEmail}`, { type: 'json' });
            if (!userData) {
              results.errors.push({ email: userEmail, error: 'User not found.' });
              continue;
            }

            // Only allow profile field updates (name, phone, pan, address, tamilName, notes)
            // Explicitly disallow roles and email changes
            if (u.name !== undefined) userData.name = u.name.trim();
            if (u.phone !== undefined) userData.phone = u.phone.trim();
            if (u.pan !== undefined) userData.pan = u.pan.trim().toUpperCase();
            if (u.address !== undefined) userData.address = u.address.trim();
            if (u.tamilName !== undefined) userData.tamilName = u.tamilName.trim();
            if (u.notes !== undefined) userData.notes = u.notes.trim();

            // If roles were provided for a system admin, silently ignore them
            // (system admin roles are hardcoded and should not be changed)

            userData.lastUpdated = new Date().toISOString();
            await store.setJSON(`user:${userEmail}`, userData);
            results.updated.push(userEmail);
            continue;
          }

          const userData = await store.get(`user:${userEmail}`, { type: 'json' });
          if (!userData) {
            results.errors.push({ email: userEmail, error: 'User not found.' });
            continue;
          }

          // Apply editable fields
          if (u.name !== undefined) userData.name = u.name.trim();
          if (u.phone !== undefined) userData.phone = u.phone.trim();
          if (u.pan !== undefined) userData.pan = u.pan.trim().toUpperCase();
          if (u.address !== undefined) userData.address = u.address.trim();
          if (u.tamilName !== undefined) userData.tamilName = u.tamilName.trim();
          if (u.notes !== undefined) userData.notes = u.notes.trim();

          // Apply roles if provided (must be valid array)
          if (u.roles !== undefined) {
            if (!Array.isArray(u.roles)) {
              results.errors.push({ email: userEmail, error: 'Roles must be an array.' });
              continue;
            }
            for (const r of u.roles) {
              if (!VALID_ROLES.includes(r)) {
                results.errors.push({ email: userEmail, error: `Invalid role "${r}".` });
                continue;
              }
            }
            userData.roles = u.roles;
          }

          userData.lastUpdated = new Date().toISOString();
          await store.setJSON(`user:${userEmail}`, userData);
          results.updated.push(userEmail);
        }

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            message: `Updated ${results.updated.length} user(s)${results.errors.length > 0 ? `, ${results.errors.length} error(s).` : '.'}`,
            results,
          }),
        };
      }

      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action. Use "set-roles", "add-user", or "bulk-update".' }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('[auth-admin] Exception:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
};