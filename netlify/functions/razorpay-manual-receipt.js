// Netlify Function: POST/PUT /razorpay/manual-receipt
// Admin only: Upload manual receipts via CSV or edit existing manual receipt entries.
// Methods: ACCOUNTTRANSFER or CASH
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VALID_METHODS = ['ACCOUNTTRANSFER', 'CASH'];

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
 * Safely extract a field from a row object, trying multiple key alternatives.
 * Handles both normalized keys (from backend parseCSV) and original-cased keys (from frontend).
 */
function getRowField(row, ...alternatives) {
  for (const alt of alternatives) {
    if (row[alt] !== undefined && row[alt] !== null && String(row[alt]).trim() !== '') {
      return String(row[alt]).trim();
    }
  }
  // Fallback: normalize keys by lowercasing and stripping non-alphanumeric
  for (const alt of alternatives) {
    const normalizedTarget = alt.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const key of Object.keys(row)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedKey === normalizedTarget) {
        const val = String(row[key]).trim();
        if (val !== '') return val;
      }
    }
  }
  return '';
}

/**
 * Parse CSV text into an array of objects.
 * First row is treated as header — normalized to lowercase, stripped of non-alphanumeric.
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return []; // header only or empty

  // Parse header — trim and lowercase, strip non-alphanumeric
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parsing (handles quoted values)
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());

    if (values.length === headers.length) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j];
      }
      results.push(row);
    }
  }
  return results;
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

    // ─── POST: Upload manual receipts (single or CSV batch) ───
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { csv, entries } = body;

      let rows = [];
      if (csv) {
        // Parse CSV — headers are already normalized by parseCSV
        rows = parseCSV(csv);
        if (rows.length === 0) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'CSV is empty or has no data rows. First row must be headers.' }) };
        }
      } else if (entries && Array.isArray(entries)) {
        rows = entries;
      } else if (body.donorName || body.donorEmail) {
        // Single entry
        rows = [body];
      } else {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Provide "csv" (string), "entries" (array), or individual fields (donorName, donorEmail, etc.)' }) };
      }

      // Get existing payments list
      const paymentsList = await store.get('payments:list', { type: 'json' }) || [];
      const results = { inserted: 0, errors: [] };

      for (const row of rows) {
        try {
          // ── Extract fields using safe getRowField (handles any key casing) ──
          const customPaymentId = getRowField(row, 'paymentId', 'paymentid', 'paymentId', 'PAYMENTID', 'payment_id', 'payId', 'payid');
          const receiptNo = getRowField(row, 'receiptNo', 'receiptno', 'receiptNumber', 'receiptnumber', 'receiptNo', 'receipt_id', 'RECEIPTNO', 'RECEIPT_NO');

          const donorName = getRowField(row, 'donorName', 'donorname', 'name', 'NAME');
          const donorEmail = getRowField(row, 'donorEmail', 'donoremail', 'email', 'EMAIL').toLowerCase();
          const amount = parseFloat(getRowField(row, 'amount', 'Amount', 'AMOUNT') || '0');
          let method = getRowField(row, 'method', 'Method', 'METHOD', 'paymentMethod', 'paymentmethod').toUpperCase();
          const donorPan = getRowField(row, 'donorPan', 'donorpan', 'pan', 'PAN').toUpperCase();
          const donorPhone = getRowField(row, 'donorPhone', 'donorphone', 'phone', 'PHONE');
          const donorAddress = getRowField(row, 'donorAddress', 'donoraddress', 'address', 'ADDRESS');
          const paymentDate = getRowField(row, 'paymentDate', 'paymentdate', 'date', 'DATE') || new Date().toISOString().split('T')[0];
          const notes = getRowField(row, 'notes', 'comment', 'donorComment', 'donorcomment', 'NOTES');

          // Validate required fields
          if (!donorName) {
            results.errors.push({ row: row, error: 'Donor name is required' });
            continue;
          }
          if (!donorEmail || !donorEmail.includes('@')) {
            results.errors.push({ row: row, error: 'Valid donor email is required' });
            continue;
          }
          if (isNaN(amount) || amount <= 0) {
            results.errors.push({ row: row, error: 'Valid positive amount is required' });
            continue;
          }

          // Validate method
          if (!VALID_METHODS.includes(method)) {
            // Try to map common variations
            const methodMap = {
              'ACCOUNT TRANSFER': 'ACCOUNTTRANSFER',
              'ACCOUNT_TRANSFER': 'ACCOUNTTRANSFER',
              'BANK TRANSFER': 'ACCOUNTTRANSFER',
              'BANKTRANSFER': 'ACCOUNTTRANSFER',
              'ONLINE TRANSFER': 'ACCOUNTTRANSFER',
              'ONLINETRANSFER': 'ACCOUNTTRANSFER',
              'NEFT': 'ACCOUNTTRANSFER',
              'RTGS': 'ACCOUNTTRANSFER',
              'IMPS': 'ACCOUNTTRANSFER',
              'UPI': 'ACCOUNTTRANSFER',
            };
            method = methodMap[method] || method;
            if (!VALID_METHODS.includes(method)) {
              results.errors.push({ row: row, error: `Invalid method "${method}". Must be ACCOUNTTRANSFER or CASH` });
              continue;
            }
          }

          // ── Sync user record from payment donor data (always: runs before duplicate payment check) ──
          // This mirrors razorpay-sync.js logic — user update happens for every valid row,
          // even if the payment record already exists.
          try {
            const usersList = await store.get('users:list', { type: 'json' }) || [];
            const email = donorEmail.toLowerCase().trim();
            const userExists = usersList.includes(email);

            if (userExists) {
              // Fetch current user record and update empty fields
              const userData = await store.get(`user:${email}`, { type: 'json' });
              if (userData) {
                let needsUpdate = false;

                if (donorName && (!userData.name || userData.name.trim() === '')) {
                  userData.name = donorName;
                  needsUpdate = true;
                }
                if (donorPhone && (!userData.phone || userData.phone.trim() === '')) {
                  userData.phone = donorPhone;
                  needsUpdate = true;
                }
                if (donorPan && (!userData.pan || userData.pan.trim() === '')) {
                  userData.pan = donorPan;
                  needsUpdate = true;
                }
                if (donorAddress && (!userData.address || userData.address.trim() === '')) {
                  userData.address = donorAddress;
                  needsUpdate = true;
                }

                if (needsUpdate) {
                  userData.lastUpdated = new Date().toISOString();
                  userData.lastUpdatedBy = session.email;
                  await store.setJSON(`user:${email}`, userData);
                }
              }
            } else {
              // Create new user from payment donor data
              const newUser = {
                email: email,
                name: donorName || '',
                phone: donorPhone || '',
                pan: donorPan || '',
                address: donorAddress || '',
                roles: [],
                role: null,
                source: 'manual-receipt',
                createdBy: session.email,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                lastUpdatedBy: session.email,
              };

              await store.setJSON(`user:${email}`, newUser);

              // Add to users list
              if (!usersList.includes(email)) {
                usersList.push(email);
                await store.setJSON('users:list', usersList);
              }
            }
          } catch (userErr) {
            console.error('[razorpay-manual-receipt] User sync error for', donorEmail, ':', userErr.message);
            // Non-fatal: log but don't fail the payment insertion
          }

          // ── Determine payment ID: use customPaymentId if provided, else generate ──
          let paymentId;
          if (customPaymentId) {
            paymentId = customPaymentId;
            // Check if this payment ID already exists (bank txn IDs are unique)
            const existing = await store.get(`payment:${paymentId}`, { type: 'json' });
            if (existing) {
              results.errors.push({ row: row, error: `Duplicate payment ID "${paymentId}" — record already exists. Skipping.` });
              continue;
            }
          } else {
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            paymentId = `MANUAL-${timestamp}-${randomSuffix}`;
          }

          // Generate order ID
          const orderId = `MANUAL-ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

          // Parse payment date
          let createdAtTs = Math.floor(new Date(paymentDate + 'T00:00:00+05:30').getTime() / 1000);
          if (isNaN(createdAtTs)) {
            createdAtTs = Math.floor(Date.now() / 1000);
          }

          const paymentRecord = {
            paymentId,
            orderId,
            amount,
            currency: 'INR',
            status: 'captured',
            method: method,
            email: donorEmail,
            contact: donorPhone,
            donorName,
            donorEmail,
            donorPhone,
            donorAddress,
            donorPan,
            donorComment: notes,
            receiptNo: receiptNo || '',      // NEW: store receipt number
            bankTransactionId: customPaymentId || '',  // NEW: store original bank txn ID explicitly
            fee: 0,
            tax: 0,
            createdAt: createdAtTs,
            createdAtDate: new Date(createdAtTs * 1000).toISOString(),
            isManualReceipt: true,
            manualNotes: notes,
            createdBy: session.email,
            syncedAt: new Date().toISOString(),
            syncedBy: session.email,
          };

          await store.setJSON(`payment:${paymentId}`, paymentRecord);

          // Add to payments list
          if (!paymentsList.includes(paymentId)) {
            paymentsList.push(paymentId);
          }

          results.inserted++;
        } catch (err) {
          results.errors.push({ row: row, error: err.message });
        }
      }

      // Save updated payments list
      await store.setJSON('payments:list', paymentsList);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          result: results,
          message: `✅ ${results.inserted} manual receipt(s) uploaded. ${results.errors.length} error(s).`,
        }),
      };
    }

    // ─── PUT: Edit an existing payment ───
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const { paymentId, donorName, donorEmail, amount, method, donorPan, donorPhone, donorAddress, notes, receiptNo, paymentDate } = body;

      if (!paymentId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'paymentId is required' }) };
      }

      const existing = await store.get(`payment:${paymentId}`, { type: 'json' });
      if (!existing) {
        return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment record not found' }) };
      }

      const isManual = existing.isManualReceipt === true;

      // For manual receipts: allow editing all fields
      // For Razorpay payments: only allow editing receiptNo and notes
      if (!isManual) {
        // Only receiptNo and notes can be edited for Razorpay payments
        const allowedFields = ['receiptNo', 'notes'];
        const attemptedFields = Object.keys(body).filter(k => k !== 'paymentId');
        const disallowed = attemptedFields.filter(f => !allowedFields.includes(f));
        if (disallowed.length > 0) {
          return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: `Only receiptNo and notes can be edited for Razorpay payments. Cannot edit: ${disallowed.join(', ')}` }) };
        }
      }

      // Update fields (only if provided)
      if (donorName !== undefined) existing.donorName = donorName.trim();
      if (donorEmail !== undefined) {
        existing.donorEmail = donorEmail.trim().toLowerCase();
        existing.email = donorEmail.trim().toLowerCase();
      }
      if (amount !== undefined) {
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid amount' }) };
        }
        existing.amount = amt;
      }
      if (method !== undefined) {
        const m = method.toUpperCase().trim();
        if (!VALID_METHODS.includes(m)) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Invalid method "${method}". Must be ACCOUNTTRANSFER or CASH` }) };
        }
        existing.method = m;
      }
      if (donorPan !== undefined) existing.donorPan = donorPan.trim().toUpperCase();
      if (donorPhone !== undefined) existing.donorPhone = donorPhone.trim();
      if (donorAddress !== undefined) existing.donorAddress = donorAddress.trim();
      if (paymentDate !== undefined) {
        const parsedTs = Math.floor(new Date(paymentDate + 'T00:00:00+05:30').getTime() / 1000);
        if (!isNaN(parsedTs)) {
          existing.paymentDate = paymentDate;
          existing.createdAt = parsedTs;
          existing.createdAtDate = new Date(parsedTs * 1000).toISOString();
        }
      }
      if (notes !== undefined) {
        existing.manualNotes = notes.trim();
        existing.donorComment = notes.trim();
      }
      if (receiptNo !== undefined) existing.receiptNo = receiptNo.trim();
      existing.lastEditedAt = new Date().toISOString();
      existing.lastEditedBy = session.email;

      // Handle payment ID change for manual receipts
      const newPaymentId = body.newPaymentId;
      if (isManual && newPaymentId && newPaymentId !== paymentId) {
        // Check if new payment ID already exists
        const existingNew = await store.get(`payment:${newPaymentId}`, { type: 'json' });
        if (existingNew) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Payment ID "${newPaymentId}" already exists. Cannot rename.` }) };
        }
        // Update the payment record with new ID
        existing.paymentId = newPaymentId;
        existing.bankTransactionId = newPaymentId;
        await store.setJSON(`payment:${newPaymentId}`, existing);
        // Delete old key
        await store.delete(`payment:${paymentId}`);
        // Update the payments list
        const paymentsList = await store.get('payments:list', { type: 'json' }) || [];
        const idx = paymentsList.indexOf(paymentId);
        if (idx !== -1) {
          paymentsList[idx] = newPaymentId;
          await store.setJSON('payments:list', paymentsList);
        }
      } else {
        await store.setJSON(`payment:${paymentId}`, existing);
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          message: '✅ Payment updated successfully.',
          payment: existing,
        }),
      };
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed. Use POST (upload) or PUT (edit).' }),
    };
  } catch (err) {
    console.error('[/razorpay/manual-receipt] Error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to process manual receipt: ' + err.message }),
    };
  }
};