// Netlify Function: GET /razorpay/admin-payments
// Admin only (hardcoded system admin): Returns paginated payment history for ALL users.
// Uses cursor-based pagination on the stored payments:list to avoid loading all records.
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

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

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
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

    // ── Parse pagination params ──
    const page = Math.max(1, parseInt(event.queryStringParameters?.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.queryStringParameters?.limit) || DEFAULT_LIMIT));

    // ── Read the payments list (array of payment IDs, ordered oldest-first insertion order) ──
    const paymentsList = await store.get('payments:list', { type: 'json' }) || [];

    // Reverse to get newest-first (most recently synced payments come last in array)
    const reversed = [...paymentsList].reverse();
    const totalCount = reversed.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    // Calculate slice for the requested page
    const startIdx = (page - 1) * limit;
    const endIdx = Math.min(startIdx + limit, totalCount);

    if (startIdx >= totalCount) {
      // Page beyond available data
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          payments: [],
          pagination: {
            page,
            limit,
            totalCount,
            totalPages,
            hasNext: false,
            hasPrev: page > 1,
          },
        }),
      };
    }

    const pageIds = reversed.slice(startIdx, endIdx);

    // ── Fetch each payment record for this page ──
    // We fetch only what we need — NOT the entire dataset
    const paymentRecords = [];
    for (const paymentId of pageIds) {
      try {
        const payment = await store.get(`payment:${paymentId}`, { type: 'json' });
        if (payment) {
          paymentRecords.push(payment);
        }
      } catch (_) {
        // Skip corrupt records
      }
    }

    // Sort by createdAt descending (newest first within the page)
    paymentRecords.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        payments: paymentRecords,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      }),
    };
  } catch (err) {
    console.error('[/razorpay/admin-payments] Error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to fetch payment history: ' + err.message }),
    };
  }
};