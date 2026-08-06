// Netlify Function: POST /bank/create-payment
// Admin only: Create/update a payment history record from a bank transaction.
const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getBankStore } = require('./bank-store');

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
 * Generate the next receipt number for a given date in the format: yyyy/mm/dd/<sequence>
 * The sequence is a zero-padded 3-digit number that increments per date.
 * Scans existing payment records' receiptNo values to find the max sequence for that date.
 */
async function generateNextReceiptNumber(store, dateStr) {
  const [y, m, d] = String(dateStr).split('T')[0].split('-');
  if (!y || !m || !d) return '';
  const prefix = `${y}/${m}/${d}/`;

  let maxSeq = 0;
  const receiptsMap = await store.get('receipts:map', { type: 'json' }) || {};
  for (const receiptNo of Object.keys(receiptsMap)) {
    if (receiptNo.startsWith(prefix)) {
      const seqStr = receiptNo.substring(prefix.length);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

function parseBankDate(dateStr, fallback) {
  const fb = fallback || Date.now();
  const def = { ts: Math.floor(fb / 1000), iso: new Date(fb).toISOString() };
  if (!dateStr) return def;
  try {
    const parts = String(dateStr).trim().split('/');
    if (parts.length === 3) {
      const date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      if (!isNaN(date.getTime())) return { ts: Math.floor(date.getTime() / 1000), iso: date.toISOString() };
    }
  } catch (_) {}
  return def;
}

const PAYMENT_TO_USER_FIELD_MAP = { donorName: 'name', donorPhone: 'phone', donorPan: 'pan', donorAddress: 'address' };

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

    // ─── SUGGEST payment ID and receipt number for a bank transaction ───
    if (action === 'suggest') {
      const { transactionKey } = body;
      if (!transactionKey || typeof transactionKey !== 'string' || transactionKey.trim() === '') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Bank transaction key is required.' }) };
      }

      const bankStore = await getBankStore(event);
      const txn = await bankStore.get(`transaction:${transactionKey}`, { type: 'json' });
      if (!txn) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Bank transaction not found.' }) };
      if (txn.paymentId) return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: `This transaction already has a payment ID: ${txn.paymentId}` }) };

      // Suggest a payment ID from the narration — use the narration as-is
      const narration = txn.narration || '';
      // Use the narration exactly as it appears, keeping all characters (including /, spaces, etc.)
      let suggestedPaymentId = narration.trim();
      // Limit length
      if (suggestedPaymentId.length > 60) suggestedPaymentId = suggestedPaymentId.substring(0, 60);
      if (!suggestedPaymentId) suggestedPaymentId = 'BANK-TXN';

      // Generate suggested receipt number based on the transaction date
      const { iso: createdAtDate } = parseBankDate(txn.tranDate, Date.now());
      const suggestedReceiptNo = await generateNextReceiptNumber(store, createdAtDate);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          suggestedPaymentId,
          suggestedReceiptNo,
          narration,
        }),
      };
    }

    // ─── CREATE payment from bank transaction ───
    if (action === 'create') {
      const { transactionKey, userId, paymentFields } = body;
      if (!transactionKey || typeof transactionKey !== 'string' || transactionKey.trim() === '') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Bank transaction key is required.' }) };
      }

      const bankStore = await getBankStore(event);
      const txn = await bankStore.get(`transaction:${transactionKey}`, { type: 'json' });
      if (!txn) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Bank transaction not found.' }) };
      if (txn.paymentId) return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: `This transaction already has a payment ID: ${txn.paymentId}` }) };

      const amount = parseFloat(txn.deposit);
      if (!amount || amount <= 0) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'This transaction is not a deposit (CR). Cannot create a payment record.' }) };

      let userData = null;
      let normalizedUserId = '';
      if (userId && typeof userId === 'string' && userId.trim() !== '') {
        normalizedUserId = userId.toLowerCase().trim();
        userData = await store.get(`user:${normalizedUserId}`, { type: 'json' });
        if (!userData) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User not found with ID: ' + userId }) };
      }

      const { ts: createdAtTs, iso: createdAtDate } = parseBankDate(txn.tranDate, Date.now());
      const pf = paymentFields || {};
      const donorName = String(pf.donorName || userData?.name || '').trim();
      const donorPhone = String(pf.donorPhone || userData?.phone || '').trim();
      const donorEmailRaw = String(pf.donorEmail || userData?.email || normalizedUserId || '').trim();
      const donorPan = String(pf.donorPan || userData?.pan || '').trim().toUpperCase();
      const donorAddress = String(pf.donorAddress || userData?.address || '').trim();
      const donorComment = String(pf.donorComment || txn.narration || '').trim();

      // ── Payment ID: must be provided and must be part of the narration ──
      const paymentId = String(pf.paymentId || '').trim();
      if (!paymentId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment ID is required. It should be part of the bank narration.' }) };
      }
      // Validate payment ID is part of the narration (case-insensitive)
      const narrationUpper = (txn.narration || '').toUpperCase();
      if (!narrationUpper.includes(paymentId.toUpperCase())) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Payment ID "${paymentId}" must be part of the bank narration. Narration: "${txn.narration || ''}"` }) };
      }
      // Check payment ID doesn't already exist
      const existingPayment = await store.get(`payment:${paymentId}`, { type: 'json' });
      if (existingPayment) {
        return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: `Payment ID "${paymentId}" already exists. Please use a different payment ID.` }) };
      }

      // ── Receipt Number: generated (yyyy/mm/dd/<sequence>) and editable ──
      const receiptNo = String(pf.receiptNo || '').trim();
      if (!receiptNo) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Receipt number is required.' }) };
      }
      // Validate receipt number format: yyyy/mm/dd/<sequence>
      if (!/^\d{4}\/\d{2}\/\d{2}\/\d+$/.test(receiptNo)) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Receipt number "${receiptNo}" is invalid. Expected format: yyyy/mm/dd/<sequence> (e.g. 2026/05/08/001).` }) };
      }
      // Check receipt number doesn't already exist
      const receiptsMap = await store.get('receipts:map', { type: 'json' }) || {};
      if (receiptsMap[receiptNo]) {
        return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: `Receipt number "${receiptNo}" already exists (used by payment "${receiptsMap[receiptNo]}"). Please use a different receipt number.` }) };
      }

      const paymentRecord = {
        paymentId, orderId: txn.key || '', amount, currency: 'INR', status: 'captured', method: 'banktransfer',
        email: donorEmailRaw.toLowerCase(), contact: donorPhone, donorName, donorPhone, donorAddress, donorPan, donorComment,
        receiptNo,
        fee: 0, tax: 0, createdAt: createdAtTs, createdAtDate,
        syncedAt: new Date().toISOString(), syncedBy: session.email, source: 'bank-statement',
        bankTransactionKey: txn.key, bankNarration: txn.narration || '', bankTranDate: txn.tranDate || '', bankChqNo: txn.chqNo || '',
      };

      await store.setJSON(`payment:${paymentId}`, paymentRecord);
      const paymentsList = await store.get('payments:list', { type: 'json' }) || [];
      if (!paymentsList.includes(paymentId)) {
        paymentsList.push(paymentId);
        await store.setJSON('payments:list', paymentsList);
      }

      // Update receipts map with the new receipt number
      if (receiptNo) {
        receiptsMap[receiptNo] = paymentId;
        await store.setJSON('receipts:map', receiptsMap);
      }

      txn.paymentId = paymentId;
      txn.matchedAt = new Date().toISOString();
      txn.matchedBy = session.email;
      txn.paymentCreatedFromBank = true;
      await bankStore.setJSON(`transaction:${txn.key}`, txn);

      const userUpdates = [];
      let updatedUser = null;
      if (userData) {
        for (const [pfField, userField] of Object.entries(PAYMENT_TO_USER_FIELD_MAP)) {
          const val = pf[pfField] ? String(pf[pfField]).trim() : '';
          if (val && !userData[userField]) {
            userData[userField] = val;
            userUpdates.push({ field: userField, value: val });
          }
        }
        if (userUpdates.length > 0) {
          userData.lastUpdated = new Date().toISOString();
          userData.lastUpdatedBy = session.email;
          await store.setJSON(`user:${normalizedUserId}`, userData);
          updatedUser = userData;
        }
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true, payment: paymentRecord, transaction: txn, user: updatedUser, userUpdates,
          message: `✅ Payment record ${paymentId} created successfully${userUpdates.length > 0 ? ` and user updated with ${userUpdates.length} field(s)` : ''}.`,
        }),
      };
    }

    // ─── UPDATE existing payment record ───
    if (action === 'update') {
      const { paymentId, userId, paymentFields } = body;
      if (!paymentId || typeof paymentId !== 'string' || paymentId.trim() === '') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment ID is required.' }) };
      }

      const payment = await store.get(`payment:${paymentId}`, { type: 'json' });
      if (!payment) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment record not found.' }) };

      let userData = null;
      let normalizedUserId = '';
      if (userId && typeof userId === 'string' && userId.trim() !== '') {
        normalizedUserId = userId.toLowerCase().trim();
        userData = await store.get(`user:${normalizedUserId}`, { type: 'json' });
        if (!userData) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User not found with ID: ' + userId }) };
      }

      const pf = paymentFields || {};
      const updatedFields = [];
      if (pf.donorName !== undefined && pf.donorName !== null) {
        const v = String(pf.donorName).trim();
        if (payment.donorName !== v) { payment.donorName = v; updatedFields.push('donorName'); }
      }
      if (pf.donorPhone !== undefined && pf.donorPhone !== null) {
        const v = String(pf.donorPhone).trim();
        if (payment.donorPhone !== v) { payment.donorPhone = v; payment.contact = v; updatedFields.push('donorPhone'); }
      }
      if (pf.donorEmail !== undefined && pf.donorEmail !== null) {
        const v = String(pf.donorEmail).trim().toLowerCase();
        if (payment.email !== v) { payment.email = v; updatedFields.push('email'); }
      }
      if (pf.donorPan !== undefined && pf.donorPan !== null) {
        const v = String(pf.donorPan).trim().toUpperCase();
        if (payment.donorPan !== v) { payment.donorPan = v; updatedFields.push('donorPan'); }
      }
      if (pf.donorAddress !== undefined && pf.donorAddress !== null) {
        const v = String(pf.donorAddress).trim();
        if (payment.donorAddress !== v) { payment.donorAddress = v; updatedFields.push('donorAddress'); }
      }
      if (pf.donorComment !== undefined && pf.donorComment !== null) {
        const v = String(pf.donorComment).trim();
        if (payment.donorComment !== v) { payment.donorComment = v; updatedFields.push('donorComment'); }
      }

      const userUpdates = [];
      if (userData) {
        for (const [pfField, userField] of Object.entries(PAYMENT_TO_USER_FIELD_MAP)) {
          const val = pf[pfField] ? String(pf[pfField]).trim() : '';
          if (val && !userData[userField]) {
            userData[userField] = val;
            userUpdates.push({ field: userField, value: val });
          }
        }
        if (userUpdates.length > 0) {
          userData.lastUpdated = new Date().toISOString();
          userData.lastUpdatedBy = session.email;
          await store.setJSON(`user:${normalizedUserId}`, userData);
        }
      }

      payment.lastEditedAt = new Date().toISOString();
      payment.lastEditedBy = session.email;
      await store.setJSON(`payment:${paymentId}`, payment);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true, payment, user: userData, userUpdates,
          message: `✅ Payment record ${paymentId} updated successfully${userUpdates.length > 0 ? ` and user updated with ${userUpdates.length} field(s)` : ''}.`,
        }),
      };
    }

    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action. Use "create" or "update".' }) };
  } catch (err) {
    console.error('[/bank/create-payment] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};