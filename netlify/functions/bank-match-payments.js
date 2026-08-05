// Netlify Function: POST /bank/match-payments
// Admin only: Match payment IDs from payment history against bank transaction narrations.
// For each payment ID, search all bank transaction narrations.
// - If exactly 1 match: update the bank transaction with the payment ID
// - If 0 matches: skip
// - If >1 matches: report message, skip
const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getBankStore } = require('./bank-store');

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

    const bankStore = await getBankStore(event);

    // ─── POST: Match payment IDs against bank transaction narrations ───
    if (event.httpMethod === 'POST') {
      // Get all payment IDs from the auth store
      const paymentsList = await store.get('payments:list', { type: 'json' }) || [];

      // Get all bank transactions
      const transactionsList = await bankStore.get('transactions:list', { type: 'json' }) || [];

      // Load all bank transactions
      const bankTransactions = [];
      for (const key of transactionsList) {
        try {
          const txn = await bankStore.get(`transaction:${key}`, { type: 'json' });
          if (txn) {
            bankTransactions.push(txn);
          }
        } catch (_) {
          // Skip corrupt records
        }
      }

      const report = {
        totalPayments: paymentsList.length,
        totalBankTransactions: bankTransactions.length,
        matched: 0,
        notFound: 0,
        multipleMatches: 0,
        alreadyMatched: 0,
        messages: [],
        details: [],
      };

      // For each payment ID, search bank transaction narrations
      for (const paymentId of paymentsList) {
        // Find bank transactions whose narration contains this payment ID
        const matches = bankTransactions.filter(txn => {
          const narration = (txn.narration || '').toLowerCase();
          return narration.includes(paymentId.toLowerCase());
        });

        if (matches.length === 0) {
          report.notFound++;
          report.details.push({ paymentId, status: 'not_found' });
        } else if (matches.length > 1) {
          report.multipleMatches++;
          report.messages.push(`Payment ID "${paymentId}" found in ${matches.length} bank transactions. Skipped.`);
          report.details.push({ paymentId, status: 'multiple_matches', count: matches.length });
        } else {
          // Exactly 1 match — update the bank transaction
          const txn = matches[0];

          // Check if already matched
          if (txn.paymentId && txn.paymentId === paymentId) {
            report.alreadyMatched++;
            report.details.push({ paymentId, status: 'already_matched', bankKey: txn.key });
          } else {
            // Update the bank transaction with the payment ID
            txn.paymentId = paymentId;
            txn.matchedAt = new Date().toISOString();
            txn.matchedBy = session.email;
            await bankStore.setJSON(`transaction:${txn.key}`, txn);
            report.matched++;
            report.details.push({ paymentId, status: 'matched', bankKey: txn.key });
          }
        }
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          report,
        }),
      };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use POST.' }) };
  } catch (err) {
    console.error('[/bank/match-payments] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};