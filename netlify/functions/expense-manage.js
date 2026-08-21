// Netlify Function: POST /expense/manage
// Admin only: Create, update, delete expense records, and link/unlink bank transactions.
//
// Actions:
//   create  — Create a new expense record
//   update  — Update an existing expense record
//   delete  — Delete an expense record
//   link    — Link a bank transaction to an expense
//   unlink  — Unlink a bank transaction from an expense
//   get     — Get a single expense record by key

const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getBankStore } = require('./bank-store');
const { getExpenseStore } = require('./expense-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

/**
 * Generate a unique key for an expense.
 */
function generateExpenseKey(description, existingKeys) {
  let key = String(description || 'expense').trim();
  key = key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (key.length > 80) key = key.substring(0, 80);
  if (!key) key = 'expense';

  let uniqueKey = key;
  let counter = 1;
  while (existingKeys.has(uniqueKey)) {
    uniqueKey = `${key}-${counter}`;
    counter++;
  }
  existingKeys.add(uniqueKey);
  return uniqueKey;
}

/**
 * Load all expense keys from the expense store.
 */
async function loadExpenseKeys(expenseStore) {
  return await expenseStore.get('expenses:list', { type: 'json' }) || [];
}

/**
 * Load a single expense record.
 */
async function loadExpense(expenseStore, key) {
  return await expenseStore.get(`expense:${key}`, { type: 'json' });
}

/**
 * Load a bank transaction record.
 */
async function loadTransaction(bankStore, key) {
  return await bankStore.get(`transaction:${key}`, { type: 'json' });
}

/**
 * Link a bank transaction to an expense (many-to-many).
 * Updates both the expense record and the transaction record.
 */
async function linkTransactionToExpense(expenseStore, bankStore, expenseKey, txnKey, sessionEmail) {
  const expense = await loadExpense(expenseStore, expenseKey);
  if (!expense) throw new Error('Expense not found.');

  const txn = await loadTransaction(bankStore, txnKey);
  if (!txn) throw new Error('Bank transaction not found.');

  // Add txnKey to expense's transactionKeys (if not already present)
  if (!expense.transactionKeys) expense.transactionKeys = [];
  if (!expense.transactionKeys.includes(txnKey)) {
    expense.transactionKeys.push(txnKey);
  }

  // Add expenseKey to transaction's expenseKeys (if not already present)
  if (!txn.expenseKeys) txn.expenseKeys = [];
  if (!txn.expenseKeys.includes(expenseKey)) {
    txn.expenseKeys.push(expenseKey);
  }

  expense.lastEditedAt = new Date().toISOString();
  expense.lastEditedBy = sessionEmail;
  txn.expenseLinkedAt = new Date().toISOString();
  txn.expenseLinkedBy = sessionEmail;

  await expenseStore.setJSON(`expense:${expenseKey}`, expense);
  await bankStore.setJSON(`transaction:${txnKey}`, txn);

  return { expense, txn };
}

/**
 * Unlink a bank transaction from an expense.
 */
async function unlinkTransactionFromExpense(expenseStore, bankStore, expenseKey, txnKey, sessionEmail) {
  const expense = await loadExpense(expenseStore, expenseKey);
  if (!expense) throw new Error('Expense not found.');

  const txn = await loadTransaction(bankStore, txnKey);
  if (!txn) throw new Error('Bank transaction not found.');

  if (expense.transactionKeys) {
    expense.transactionKeys = expense.transactionKeys.filter(k => k !== txnKey);
  }
  if (txn.expenseKeys) {
    txn.expenseKeys = txn.expenseKeys.filter(k => k !== expenseKey);
  }

  expense.lastEditedAt = new Date().toISOString();
  expense.lastEditedBy = sessionEmail;

  await expenseStore.setJSON(`expense:${expenseKey}`, expense);
  await bankStore.setJSON(`transaction:${txnKey}`, txn);

  return { expense, txn };
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);
    if (!session) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!ADMIN_EMAILS.includes(session.email)) return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use POST.' }) };

    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    const expenseStore = await getExpenseStore(event);
    const bankStore = await getBankStore(event);

    // ─── CREATE expense ───
    if (action === 'create') {
      const { description, voucherNo, paymentMode, amount, expenseDate, notes, transactionKeys, documents } = body;

      if (!description || typeof description !== 'string' || description.trim() === '') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Description is required.' }) };
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Amount must be a positive number.' }) };
      }

      const validModes = ['cash', 'bank', 'other-person'];
      const mode = String(paymentMode || 'cash').trim();
      if (!validModes.includes(mode)) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid payment mode. Use "cash", "bank", or "other-person".' }) };
      }

      // Load existing keys to generate a unique key
      const existingKeys = new Set(await loadExpenseKeys(expenseStore));
      const key = generateExpenseKey(description, existingKeys);

      const record = {
        key,
        description: description.trim(),
        voucherNo: String(voucherNo || '').trim(),
        paymentMode: mode,
        amount: amountNum,
        expenseDate: String(expenseDate || '').trim(),
        notes: String(notes || '').trim(),
        transactionKeys: Array.isArray(transactionKeys) ? transactionKeys.filter(k => typeof k === 'string' && k.trim() !== '') : [],
        documents: Array.isArray(documents) ? documents : [],
        createdAt: new Date().toISOString(),
        createdBy: session.email,
        lastEditedAt: new Date().toISOString(),
        lastEditedBy: session.email,
      };

      // Link transactions if provided
      if (record.transactionKeys.length > 0) {
        for (const txnKey of record.transactionKeys) {
          const txn = await loadTransaction(bankStore, txnKey);
          if (!txn) {
            return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: `Bank transaction not found: ${txnKey}` }) };
          }
          if (!txn.expenseKeys) txn.expenseKeys = [];
          if (!txn.expenseKeys.includes(key)) {
            txn.expenseKeys.push(key);
            txn.expenseLinkedAt = new Date().toISOString();
            txn.expenseLinkedBy = session.email;
            await bankStore.setJSON(`transaction:${txnKey}`, txn);
          }
        }
      }

      await expenseStore.setJSON(`expense:${key}`, record);

      // Update the expenses list
      const expensesList = await loadExpenseKeys(expenseStore);
      if (!expensesList.includes(key)) {
        expensesList.push(key);
        await expenseStore.setJSON('expenses:list', expensesList);
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          expense: record,
          message: `✅ Expense "${record.description}" created successfully.`,
        }),
      };
    }

    // ─── UPDATE expense ───
    if (action === 'update') {
      const { expenseKey, description, voucherNo, paymentMode, amount, expenseDate, notes } = body;

      if (!expenseKey || typeof expenseKey !== 'string' || expenseKey.trim() === '') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expense key is required.' }) };
      }

      const expense = await loadExpense(expenseStore, expenseKey);
      if (!expense) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expense not found.' }) };

      if (description !== undefined && description !== null) {
        const v = String(description).trim();
        if (v) expense.description = v;
      }
      if (voucherNo !== undefined && voucherNo !== null) {
        expense.voucherNo = String(voucherNo).trim();
      }
      if (paymentMode !== undefined && paymentMode !== null) {
        const v = String(paymentMode).trim();
        const validModes = ['cash', 'bank', 'other-person'];
        if (!validModes.includes(v)) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid payment mode. Use "cash", "bank", or "other-person".' }) };
        }
        expense.paymentMode = v;
      }
      if (amount !== undefined && amount !== null) {
        const v = parseFloat(amount);
        if (isNaN(v) || v <= 0) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Amount must be a positive number.' }) };
        }
        expense.amount = v;
      }
      if (expenseDate !== undefined && expenseDate !== null) {
        expense.expenseDate = String(expenseDate).trim();
      }
      if (notes !== undefined && notes !== null) {
        expense.notes = String(notes).trim();
      }

      expense.lastEditedAt = new Date().toISOString();
      expense.lastEditedBy = session.email;
      await expenseStore.setJSON(`expense:${expenseKey}`, expense);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          expense,
          message: `✅ Expense "${expense.description}" updated successfully.`,
        }),
      };
    }

    // ─── DELETE expense ───
    if (action === 'delete') {
      const { expenseKey } = body;
      if (!expenseKey || typeof expenseKey !== 'string' || expenseKey.trim() === '') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expense key is required.' }) };
      }

      const expense = await loadExpense(expenseStore, expenseKey);
      if (!expense) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expense not found.' }) };

      // Unlink from all linked transactions
      if (expense.transactionKeys && expense.transactionKeys.length > 0) {
        for (const txnKey of expense.transactionKeys) {
          const txn = await loadTransaction(bankStore, txnKey);
          if (txn && txn.expenseKeys) {
            txn.expenseKeys = txn.expenseKeys.filter(k => k !== expenseKey);
            await bankStore.setJSON(`transaction:${txnKey}`, txn);
          }
        }
      }

      // Delete the expense record
      await expenseStore.delete(`expense:${expenseKey}`);

      // Remove from the expenses list
      const expensesList = await loadExpenseKeys(expenseStore);
      const updatedList = expensesList.filter(k => k !== expenseKey);
      await expenseStore.setJSON('expenses:list', updatedList);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          message: `✅ Expense "${expense.description}" deleted successfully.`,
        }),
      };
    }

    // ─── LINK transaction to expense ───
    if (action === 'link') {
      const { expenseKey, transactionKey } = body;
      if (!expenseKey || !transactionKey) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Both expenseKey and transactionKey are required.' }) };
      }

      try {
        const result = await linkTransactionToExpense(expenseStore, bankStore, expenseKey, transactionKey, session.email);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            expense: result.expense,
            transaction: result.txn,
            message: `✅ Linked transaction to expense "${result.expense.description}".`,
          }),
        };
      } catch (err) {
        return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
      }
    }

    // ─── UNLINK transaction from expense ───
    if (action === 'unlink') {
      const { expenseKey, transactionKey } = body;
      if (!expenseKey || !transactionKey) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Both expenseKey and transactionKey are required.' }) };
      }

      try {
        const result = await unlinkTransactionFromExpense(expenseStore, bankStore, expenseKey, transactionKey, session.email);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            expense: result.expense,
            transaction: result.txn,
            message: `✅ Unlinked transaction from expense "${result.expense.description}".`,
          }),
        };
      } catch (err) {
        return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
      }
    }

    // ─── GET single expense ───
    if (action === 'get') {
      const { expenseKey } = body;
      if (!expenseKey || typeof expenseKey !== 'string' || expenseKey.trim() === '') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expense key is required.' }) };
      }

      const expense = await loadExpense(expenseStore, expenseKey);
      if (!expense) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expense not found.' }) };

      // Load linked transaction details
      const linkedTransactions = [];
      if (expense.transactionKeys && expense.transactionKeys.length > 0) {
        for (const txnKey of expense.transactionKeys) {
          const txn = await loadTransaction(bankStore, txnKey);
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
        }
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          expense,
          linkedTransactions,
        }),
      };
    }

    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action. Use "create", "update", "delete", "link", "unlink", or "get".' }) };
  } catch (err) {
    console.error('[/expense/manage] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};