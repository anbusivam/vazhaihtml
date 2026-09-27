// Netlify Function: POST /expense/cloudinary-search
// Lists only bill/voucher assets stored in the expense Cloudinary folder.
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || '';
const CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || '';
const EXPENSE_FOLDER = 'expense-documents';
const BILL_FOLDER = 'bills';

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

function isExpenseDocument(resource) {
  const publicId = String(resource.public_id || '');
  const folder = String(resource.folder || '');
  return [EXPENSE_FOLDER, BILL_FOLDER].some(folderName =>
    folder === folderName || folder.startsWith(`${folderName}/`) || publicId.startsWith(`${folderName}/`)
  );
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  try {
    const store = await getStore(event);
    const session = await getSession(store, event);
    if (!session) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!ADMIN_EMAILS.includes(session.email)) return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_KEY || !CLOUDINARY_SECRET) return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cloudinary not configured.' }) };

    const body = JSON.parse(event.body || '{}');
    const search = String(body.search || '').trim().toLowerCase();
    const auth = Buffer.from(`${CLOUDINARY_KEY}:${CLOUDINARY_SECRET}`).toString('base64');
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/search`;
    const folderExpression = `resource_type:image AND (folder:${EXPENSE_FOLDER}/* OR folder:${BILL_FOLDER}/*)`;
    const expression = search
      ? `${folderExpression} AND (filename:${search} OR public_id:${search})`
      : folderExpression;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression, max_results: 50, next_cursor: body.cursor || undefined }),
    });
    if (!response.ok) {
      console.error('[expense-cloudinary-search] Cloudinary error:', response.status, await response.text());
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cloudinary search failed' }) };
    }
    const data = await response.json();
    const documents = (data.resources || []).filter(resource => resource.resource_type === 'image' && isExpenseDocument(resource)).map(resource => ({
      publicId: resource.public_id,
      url: resource.secure_url || resource.url,
      filename: resource.original_filename || resource.public_id.split('/').pop(),
      contentType: resource.resource_type === 'image' ? `image/${resource.format || 'jpeg'}` : resource.format ? `application/${resource.format}` : 'application/octet-stream',
      resourceType: resource.resource_type,
      format: resource.format,
      bytes: resource.bytes,
      createdAt: resource.created_at,
      folder: resource.folder,
      thumbnail: resource.secure_url && resource.resource_type === 'image' ? resource.secure_url.replace('/upload/', '/upload/w_200,h_150,c_fill/') : resource.secure_url || resource.url,
    }));
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ documents, nextCursor: data.next_cursor || null }) };
  } catch (err) {
    console.error('[/expense/cloudinary-search] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
