// Netlify Function: GET /razorpay/user-payments
// Authenticated user: Returns payment history for the logged-in user
const { getStore } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

    // Get all payment IDs from the list
    const paymentsList = await store.get('payments:list', { type: 'json' }) || [];
    const userPayments = [];
    const userEmail = session.email.toLowerCase().trim();

    // Iterate through all payments and find ones matching this user's email
    for (const paymentId of paymentsList) {
      try {
        const payment = await store.get(`payment:${paymentId}`, { type: 'json' });
        if (payment && payment.email && payment.email.toLowerCase().trim() === userEmail) {
          userPayments.push(payment);
        }
      } catch (_) {
        // skip corrupt records
      }
    }

    // Sort by date descending (newest first)
    userPayments.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        totalCount: userPayments.length,
        payments: userPayments,
      }),
    };
  } catch (err) {
    console.error('[/razorpay/user-payments] Error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to fetch payment history.' }) };
  }
};