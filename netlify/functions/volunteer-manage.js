// Admin endpoint: GET/POST /volunteer/manage
const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getVolunteerStore } = require('./volunteer-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const STATUSES = new Set(['new', 'contacted', 'active', 'closed']);

function response(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function getSession(store, event) {
  const headers = event.headers || {};
  const cookies = headers.cookie || headers.Cookie || '';
  const authHeader = headers.authorization || headers.Authorization || '';
  let token = cookies.match(/vazhai_session=([^;]+)/)?.[1] || null;
  if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token) return null;
  const session = await store.get(`session:${token}`, { type: 'json' });
  if (!session || Date.now() > session.expiresAt) return null;
  return session;
}

async function requireAdmin(event) {
  const authStore = await getStore(event);
  const session = await getSession(authStore, event);
  if (!session) return { error: response(401, { error: 'Unauthorized' }) };
  const user = await authStore.get(`user:${session.email}`, { type: 'json' });
  const roles = Array.isArray(user?.roles) ? user.roles : (user?.role ? [user.role] : []);
  if (!ADMIN_EMAILS.includes(session.email) && !roles.includes('admin')) {
    return { error: response(403, { error: 'Admin access required.' }) };
  }
  return { authStore, session };
}

async function readRecords(store) {
  const ids = await store.get('volunteers:list', { type: 'json' }) || [];
  const records = await Promise.all(ids.map(id => store.get(`volunteer:${id}`, { type: 'json' })));
  return records.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return response(200, {});

  try {
    const access = await requireAdmin(event);
    if (access.error) return access.error;
    const store = await getVolunteerStore(event);

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const search = String(params.search || '').trim().toLowerCase();
      const status = String(params.status || '').trim();
      let records = await readRecords(store);
      if (status && STATUSES.has(status)) records = records.filter(record => record.status === status);
      if (search) {
        records = records.filter(record => [record.id, record.name, record.email, record.phone, record.city]
          .some(value => String(value || '').toLowerCase().includes(search)));
      }
      return response(200, { success: true, volunteers: records });
    }

    if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });
    const body = JSON.parse(event.body || '{}');
    const action = body.action;
    const id = String(body.id || '').trim();
    if (!id) return response(400, { error: 'Volunteer ID is required.' });
    const record = await store.get(`volunteer:${id}`, { type: 'json' });
    if (!record) return response(404, { error: 'Volunteer registration not found.' });

    if (action === 'update') {
      if (body.status !== undefined) {
        const status = String(body.status).trim();
        if (!STATUSES.has(status)) return response(400, { error: 'Invalid status.' });
        record.status = status;
      }
      if (body.notes !== undefined) record.notes = String(body.notes || '').trim().slice(0, 4000);
      record.updatedAt = new Date().toISOString();
      record.updatedBy = access.session.email;
      await store.setJSON(`volunteer:${id}`, record);
      return response(200, { success: true, volunteer: record });
    }

    if (action === 'delete') {
      const ids = await store.get('volunteers:list', { type: 'json' }) || [];
      await store.delete(`volunteer:${id}`);
      await store.setJSON('volunteers:list', ids.filter(existingId => existingId !== id));
      return response(200, { success: true, id });
    }

    return response(400, { error: 'Unknown action.' });
  } catch (err) {
    console.error('[volunteer-manage] Error:', err.message, err.stack);
    return response(500, { error: 'Server error.' });
  }
};
