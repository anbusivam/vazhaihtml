// Netlify Function: GET/POST /donor-wall/manage
// Admin only: Preview donors with amounts (from the built wall) and manage
// the permanent exclusion list. Exclusions persist across the 1-year window.
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

async function loadExcluded(store) {
  const excludedObj = await store.get('donor-wall-excluded', { type: 'json' });
  if (excludedObj && Array.isArray(excludedObj.excluded)) return excludedObj.excluded;
  return [];
}

async function saveExcluded(store, list) {
  await store.setJSON('donor-wall-excluded', { excluded: list });
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);
    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    if (!ADMIN_EMAILS.includes(session.email)) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    }

    // ── GET: Return the built wall (with amounts) + the exclusion list ──
    if (event.httpMethod === 'GET') {
      const wall = await store.get('donor-wall', { type: 'json' });
      const excludedList = await loadExcluded(store);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          wall: wall || { updated: null, donors: [] },
          excluded: excludedList,
        }),
      };
    }

    // ── POST: Update the exclusion list ──
    if (event.httpMethod === 'POST') {
      const { action, email, name } = JSON.parse(event.body || '{}');

      if (!email || !email.trim()) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Email is required.' }) };
      }

      const normalizedEmail = email.trim().toLowerCase();
      const excludedList = await loadExcluded(store);

      if (action === 'exclude') {
        // Prevent duplicates
        if (!excludedList.some(e => e.email === normalizedEmail)) {
          excludedList.push({
            email: normalizedEmail,
            name: (name || '').trim(),
            excludedAt: new Date().toISOString(),
            excludedBy: session.email,
          });
          await saveExcluded(store, excludedList);
        }
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, action: 'excluded', email: normalizedEmail }),
        };
      }

      if (action === 'unexclude') {
        const filtered = excludedList.filter(e => e.email !== normalizedEmail);
        await saveExcluded(store, filtered);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, action: 'unexcluded', email: normalizedEmail }),
        };
      }

      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Action must be "exclude" or "unexclude".' }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('[/donor-wall/manage] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed: ' + err.message }) };
  }
};