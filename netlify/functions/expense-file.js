// Netlify Function: GET /expense/file
// Admin only: Serve an uploaded expense document.
// Requires the document ID as a query parameter: ?doc=<docId>
// Returns the file content with the appropriate content type.

const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getExpenseStore } = require('./expense-store');

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
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);
    if (!session) return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!ADMIN_EMAILS.includes(session.email)) return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed. Use GET.' }) };

    const params = event.queryStringParameters || {};
    const docId = (params.doc || '').trim();
    if (!docId) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Document ID is required. Use ?doc=<docId>' }) };
    }

    const expenseStore = await getExpenseStore(event);

    // Retrieve the document blob
    const docKey = `document:${docId}`;
    const blob = await expenseStore.get(docKey);

    if (!blob) {
      return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Document not found.' }) };
    }

    // Get metadata
    const metadata = blob.metadata || {};
    const contentType = metadata.contentType || 'application/octet-stream';
    const filename = metadata.filename || 'document';

    // Read the blob data
    const data = await blob.arrayBuffer();
    const buffer = Buffer.from(data);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('[/expense/file] Error:', err.message, err.stack);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};