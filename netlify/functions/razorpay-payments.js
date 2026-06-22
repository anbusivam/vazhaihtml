// Netlify Function: GET /razorpay/payments
// Fetches successful Razorpay payments within a date range (admin only)
const Razorpay = require('razorpay');
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);

    // Must be authenticated admin
    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    if (!ADMIN_EMAILS.includes(session.email)) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    }

    // Read query params
    const fromDate = event.queryStringParameters?.from;
    const toDate = event.queryStringParameters?.to;

    if (!fromDate || !toDate) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Both "from" and "to" date query parameters are required (YYYY-MM-DD format).' }) };
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Dates must be in YYYY-MM-DD format.' }) };
    }

    const fromTs = Math.floor(new Date(fromDate + 'T00:00:00+05:30').getTime() / 1000);
    const toTs = Math.floor(new Date(toDate + 'T23:59:59+05:30').getTime() / 1000);

    if (fromTs >= toTs) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: '"from" date must be before or equal to "to" date.' }) };
    }

    // Init Razorpay with admin credentials
    const rzpKeyId = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzpKeyId || !rzpKeySecret) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server config error: missing Razorpay keys.' }) };
    }

    const razorpay = new Razorpay({
      key_id: rzpKeyId,
      key_secret: rzpKeySecret,
    });

    // Fetch payments page by page within the date range
    let allPayments = [];
    let page = 1;
    const pageSize = 100; // Razorpay max per page
    let hasMore = true;

    while (hasMore) {
      const items = await razorpay.payments.all({
        count: pageSize,
        skip: (page - 1) * pageSize,
        from: fromTs,
        to: toTs,
      });

      const payments = items.items || [];

      // For captured (successful) payments, include full details
      for (const p of payments) {
        let donorInfo = {};
        if (p.notes && p.notes.donor) {
          try {
            donorInfo = JSON.parse(p.notes.donor);
          } catch (_) {
            donorInfo = { raw: p.notes.donor };
          }
        }

        allPayments.push({
          id: p.id,
          orderId: p.order_id,
          amount: p.amount / 100, // convert paise to rupees
          currency: p.currency,
          status: p.status,
          method: p.method,
          description: p.description,
          email: p.email,
          contact: p.contact,
          fee: p.fee / 100 || 0,
          tax: p.tax / 100 || 0,
          createdAt: p.created_at,
          createdAtDate: new Date(p.created_at * 1000).toISOString(),
          donorName: donorInfo.name || '',
          donorEmail: donorInfo.email || p.email || '',
          donorPhone: donorInfo.phone || p.contact || '',
          donorAddress: donorInfo.address || '',
          donorPan: donorInfo.pan || '',
          donorComment: donorInfo.comment || '',
          notes: p.notes,
        });
      }

      if (payments.length < pageSize) {
        hasMore = false;
      }
      page++;
    }

    // Sort by creation date descending (newest first)
    allPayments.sort((a, b) => b.createdAt - a.createdAt);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        from: fromDate,
        to: toDate,
        totalCount: allPayments.length,
        payments: allPayments,
      }),
    };
  } catch (err) {
    console.error('[/razorpay/payments] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to fetch payments from Razorpay: ' + err.message }) };
  }
};