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

    // ── Parse filter and pagination params ──
    const params = event.queryStringParameters || {};
    const thankStatus = (params.thankStatus || params.status || '').trim().toLowerCase();
    const period = (params.period || 'last2months').trim().toLowerCase();
    const dateFromRaw = (params.dateFrom || '').trim();
    const dateToRaw = (params.dateTo || '').trim();
    const page = Math.max(1, parseInt(event.queryStringParameters?.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.queryStringParameters?.limit) || DEFAULT_LIMIT));

    let dateFrom = null;
    let dateTo = null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'custom') {
      if (dateFromRaw) dateFrom = new Date(dateFromRaw + 'T00:00:00');
      if (dateToRaw) dateTo = new Date(dateToRaw + 'T23:59:59.999');
    } else if (period === 'last2months' || period === 'last1month' || period === 'last3months' || period === 'last6months') {
      const months = Number(period.match(/^last(\d+)months?$/)[1]);
      dateFrom = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
      dateTo = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    } else if (period === 'thisyear') {
      dateFrom = new Date(today.getFullYear(), 0, 1);
      dateTo = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    }

    // ── Read the payments list (array of payment IDs, ordered oldest-first insertion order) ──
    const paymentsList = await store.get('payments:list', { type: 'json' }) || [];

    const paymentRecords = [];
    for (const paymentId of paymentsList) {
      try {
        const payment = await store.get(`payment:${paymentId}`, { type: 'json' });
        if (payment) paymentRecords.push(payment);
      } catch (_) {
        // Skip corrupt records
      }
    }

    function paymentDate(payment) {
      if (payment.paymentDate) {
        const date = new Date(String(payment.paymentDate).includes('T') ? payment.paymentDate : payment.paymentDate + 'T00:00:00');
        if (!Number.isNaN(date.getTime())) return date;
      }
      if (payment.createdAtDate) {
        const date = new Date(payment.createdAtDate);
        if (!Number.isNaN(date.getTime())) return date;
      }
      if (payment.createdAt) {
        const date = new Date(payment.createdAt * 1000);
        if (!Number.isNaN(date.getTime())) return date;
      }
      return null;
    }

    const filteredPayments = paymentRecords.filter(payment => {
      const normalizedThankStatus = String(payment.thankLetterSent || '').trim().toLowerCase();
      const isThanked = payment.thankLetterSent === true || normalizedThankStatus === 'yes' ||
        normalizedThankStatus === 'true' || normalizedThankStatus === '1';
      if (thankStatus === 'needs-thanks' && (payment.status !== 'captured' || isThanked)) return false;
      if (thankStatus === 'thanked' && (payment.status !== 'captured' || !isThanked)) return false;
      if (dateFrom || dateTo) {
        const date = paymentDate(payment);
        if (!date) return false;
        if (dateFrom && date < dateFrom) return false;
        if (dateTo && date > dateTo) return false;
      }
      return true;
    });

    filteredPayments.sort((a, b) => {
      const dateA = paymentDate(a);
      const dateB = paymentDate(b);
      return (dateB ? dateB.getTime() : 0) - (dateA ? dateA.getTime() : 0);
    });

    const totalCount = filteredPayments.length;
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

    const payments = filteredPayments.slice(startIdx, endIdx);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        payments,
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