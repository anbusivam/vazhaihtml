// Netlify Function: GET /expense/list
// Admin only: List all expense records with optional filtering.
// Returns expenses with linked transaction summaries.

const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getBankStore } = require('./bank-store');
const { getExpenseStore } = require('./expense-store');

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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);
    if (!session) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!ADMIN_EMAILS.includes(session.email)) return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use GET.' }) };

    const expenseStore = await getExpenseStore(event);
    const bankStore = await getBankStore(event);

    const params = event.queryStringParameters || {};
    const search = (params.search || '').trim().toLowerCase();
    const paymentMode = (params.paymentMode || '').trim().toLowerCase();
    const transactionKey = (params.transactionKey || '').trim();

    // Load all expense keys
    const expensesList = await expenseStore.get('expenses:list', { type: 'json' }) || [];

    // Load all expenses
    const allExpenses = [];
    for (const key of expensesList) {
      try {
        const expense = await expenseStore.get(`expense:${key}`, { type: 'json' });
        if (expense) allExpenses.push(expense);
      } catch (_) {
        // Skip corrupt records
      }
    }

    // Apply filters
    let filtered = allExpenses.filter(expense => {
      if (search) {
        const description = (expense.description || '').toLowerCase();
        const voucherNo = (expense.voucherNo || '').toLowerCase();
        const notes = (expense.notes || '').toLowerCase();
        if (!description.includes(search) && !voucherNo.includes(search) && !notes.includes(search)) return false;
      }
      if (paymentMode && expense.paymentMode !== paymentMode) return false;
      if (transactionKey && (!expense.transactionKeys || !expense.transactionKeys.includes(transactionKey))) return false;
      return true;
    });

    // Sort by createdAt descending (newest first)
    filtered.sort((a, b) => {
      const ta = a.createdAt || '';
      const tb = b.createdAt || '';
      return String(tb).localeCompare(String(ta));
    });

    // Load linked transaction summaries for each expense
    const expensesWithTransactions = [];
    for (const expense of filtered) {
      const linkedTransactions = [];
      if (expense.transactionKeys && expense.transactionKeys.length > 0) {
        for (const txnKey of expense.transactionKeys) {
          try {
            const txn = await bankStore.get(`transaction:${txnKey}`, { type: 'json' });
            if (txn) {
              linkedTransactions.push({
                key: txn.key,
                tranDate: txn.tranDate,
                narration: txn.narration,
                withdrawal: txn.withdrawal,
                deposit: txn.deposit,
                chqNo: txn.chqNo,
              });
            }
          } catch (_) {}
        }
      }
      expensesWithTransactions.push({ ...expense, linkedTransactions });
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        expenses: expensesWithTransactions,
        total: expensesWithTransactions.length,
      }),
    };
  } catch (err) {
    console.error('[/expense/list] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};