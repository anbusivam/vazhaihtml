// Netlify Function: POST /razorpay/sync
// Admin only: Fetches Razorpay payments for a date range, updates user records
// and creates payment records. Returns a detailed comparison report.
const Razorpay = require('razorpay');
const { getStore, ADMIN_EMAILS } = require('./auth-store');

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

// Fields to sync from payment donor data to user record
// Maps: payment field → user field
const FIELD_MAP = {
  donorName: 'name',
  donorPhone: 'phone',
  donorPan: 'pan',
  donorAddress: 'address',
  donorEmail: 'email',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
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

    const { from, to } = JSON.parse(event.body || '{}');
    if (!from || !to) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Both "from" and "to" dates are required (YYYY-MM-DD).' }) };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Dates must be in YYYY-MM-DD format.' }) };
    }

    const fromTs = Math.floor(new Date(from + 'T00:00:00+05:30').getTime() / 1000);
    const toTs = Math.floor(new Date(to + 'T23:59:59+05:30').getTime() / 1000);

    const rzpKeyId = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzpKeyId || !rzpKeySecret) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing Razorpay keys.' }) };
    }

    const razorpay = new Razorpay({ key_id: rzpKeyId, key_secret: rzpKeySecret });

    // ── Fetch all payments from Razorpay ──
    let allPayments = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const items = await razorpay.payments.all({
        count: pageSize,
        skip: (page - 1) * pageSize,
        from: fromTs,
        to: toTs,
      });
      const payments = items.items || [];
      for (const p of payments) {
        let donorInfo = {};
        if (p.notes && p.notes.donor) {
          try { donorInfo = JSON.parse(p.notes.donor); } catch (_) { donorInfo = { raw: p.notes.donor }; }
        }
        allPayments.push({
          id: p.id,
          orderId: p.order_id,
          amount: p.amount / 100,
          currency: p.currency,
          status: p.status,
          method: p.method,
          email: p.email,
          contact: p.contact,
          createdAt: p.created_at,
          createdAtDate: new Date(p.created_at * 1000).toISOString(),
          fee: p.fee / 100 || 0,
          tax: p.tax / 100 || 0,
          donorName: donorInfo.name || '',
          donorEmail: donorInfo.email || p.email || '',
          donorPhone: donorInfo.phone || p.contact || '',
          donorAddress: donorInfo.address || '',
          donorPan: donorInfo.pan || '',
          donorComment: donorInfo.comment || '',
        });
      }
      if (payments.length < pageSize) hasMore = false;
      page++;
    }

    // ── Process: Sync users & store payments ──
    const report = {
      from,
      to,
      totalPayments: allPayments.length,
      usersFound: 0,
      usersNotFound: 0,
      usersUpdated: 0,
      usersAlreadyCurrent: 0,
      paymentsRecorded: 0,
      paymentsAlreadyExist: 0,
      details: [],
      errors: [],
    };

    // Get the existing users list
    const usersList = await store.get('users:list', { type: 'json' }) || [];
    const paymentsList = await store.get('payments:list', { type: 'json' }) || [];

    for (const payment of allPayments) {
      const detail = {
        paymentId: payment.id,
        amount: payment.amount,
        email: payment.donorEmail || payment.email,
        date: payment.createdAtDate,
        status: payment.status,
        userAction: '',
        userDifferences: [],
        paymentAction: '',
      };

      try {
        const email = (payment.donorEmail || payment.email || '').toLowerCase().trim();
        const userExists = usersList.includes(email);

        if (userExists) {
          detail.userAction = 'User found';
          report.usersFound++;

          // Fetch current user record
          const userData = await store.get(`user:${email}`, { type: 'json' });
          if (userData) {
            // Compare and update fields (only if empty)
            // For Sync & Update: update non-editorial fields from Razorpay data,
            // but preserve receiptNo & notes if they already have values
            const differences = [];
            let needsUpdate = false;

            // Check donor name → user name
            const donorName = payment.donorName || '';
            if (donorName && (!userData.name || userData.name.trim() === '')) {
              differences.push({ field: 'name', existing: userData.name || '(empty)', new: donorName, action: 'Updated' });
              userData.name = donorName;
              needsUpdate = true;
            } else if (donorName && userData.name && userData.name !== donorName) {
              differences.push({ field: 'name', existing: userData.name, fromPayment: donorName, action: 'Kept existing (different)' });
            } else if (donorName && userData.name === donorName) {
              differences.push({ field: 'name', value: donorName, action: 'Already matches' });
            }

            // Check donor phone → user phone
            const donorPhone = payment.donorPhone || '';
            if (donorPhone && (!userData.phone || userData.phone.trim() === '')) {
              differences.push({ field: 'phone', existing: userData.phone || '(empty)', new: donorPhone, action: 'Updated' });
              userData.phone = donorPhone;
              needsUpdate = true;
            } else if (donorPhone && userData.phone && userData.phone !== donorPhone) {
              differences.push({ field: 'phone', existing: userData.phone, fromPayment: donorPhone, action: 'Kept existing (different)' });
            } else if (donorPhone && userData.phone === donorPhone) {
              differences.push({ field: 'phone', value: donorPhone, action: 'Already matches' });
            }

            // Check PAN field — may not exist on user yet
            const donorPan = payment.donorPan || '';
            if (donorPan && (!userData.pan || userData.pan.trim() === '')) {
              differences.push({ field: 'pan', existing: userData.pan || '(empty)', new: donorPan, action: 'Updated' });
              userData.pan = donorPan;
              needsUpdate = true;
            } else if (donorPan && userData.pan && userData.pan !== donorPan) {
              differences.push({ field: 'pan', existing: userData.pan, fromPayment: donorPan, action: 'Kept existing (different)' });
            } else if (donorPan && userData.pan === donorPan) {
              differences.push({ field: 'pan', value: donorPan, action: 'Already matches' });
            }

            // Check address field
            const donorAddress = payment.donorAddress || '';
            if (donorAddress && (!userData.address || userData.address.trim() === '')) {
              differences.push({ field: 'address', existing: userData.address || '(empty)', new: donorAddress, action: 'Updated' });
              userData.address = donorAddress;
              needsUpdate = true;
            } else if (donorAddress && userData.address && userData.address !== donorAddress) {
              differences.push({ field: 'address', existing: userData.address, fromPayment: donorAddress, action: 'Kept existing (different)' });
            } else if (donorAddress && userData.address === donorAddress) {
              differences.push({ field: 'address', value: donorAddress, action: 'Already matches' });
            }

            if (needsUpdate) {
              userData.lastUpdated = new Date().toISOString();
              userData.lastUpdatedBy = session.email;
              await store.setJSON(`user:${email}`, userData);
              report.usersUpdated++;
              detail.userAction = 'User updated';
            } else {
              report.usersAlreadyCurrent++;
              detail.userAction = 'No update needed';
            }

            detail.userDifferences = differences;
          }
        } else {
          // Create new user from payment donor data
          const newUser = {
            email: email,
            name: payment.donorName || '',
            phone: payment.donorPhone || '',
            pan: payment.donorPan || '',
            address: payment.donorAddress || '',
            roles: [],
            role: null,
            source: 'razorpay-sync',
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

          report.usersUpdated++;
          detail.userAction = 'User created from payment data';
          detail.userDifferences = [
            { field: 'name', existing: '(new user)', new: newUser.name, action: 'Created' },
            { field: 'phone', existing: '(new user)', new: newUser.phone, action: 'Created' },
            { field: 'pan', existing: '(new user)', new: newUser.pan, action: 'Created' },
            { field: 'address', existing: '(new user)', new: newUser.address, action: 'Created' },
          ];
        }

        // ── Store payment record (deduplicate by payment ID) ──
        // If the same payment ID already exists, UPDATE the record with latest Razorpay data.
        // Preserve receiptNo and notes (donorComment) if they already have values,
        // as these are editable fields entered by the admin.
        const paymentKey = `payment:${payment.id}`;
        const existingPayment = await store.get(paymentKey, { type: 'json' });

        const paymentRecord = {
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          method: payment.method,
          email: payment.donorEmail || payment.email || '',
          contact: payment.contact || '',
          donorName: payment.donorName || '',
          donorPhone: payment.donorPhone || '',
          donorAddress: payment.donorAddress || '',
          donorPan: payment.donorPan || '',
          donorComment: payment.donorComment || '',
          fee: payment.fee,
          tax: payment.tax,
          createdAt: payment.createdAt,
          createdAtDate: payment.createdAtDate,
          syncedAt: new Date().toISOString(),
          syncedBy: session.email,
        };

        if (existingPayment) {
          // Preserve receiptNo & notes if they already have values
          if (existingPayment.receiptNo) {
            paymentRecord.receiptNo = existingPayment.receiptNo;
          }
          if (existingPayment.manualNotes || existingPayment.donorComment) {
            paymentRecord.manualNotes = existingPayment.manualNotes || existingPayment.donorComment;
            paymentRecord.donorComment = existingPayment.manualNotes || existingPayment.donorComment;
          }
          // Mark as updated (not skipped)
          paymentRecord.lastEditedAt = new Date().toISOString();
          paymentRecord.lastEditedBy = session.email;
          await store.setJSON(paymentKey, paymentRecord);
          detail.paymentAction = 'Payment record updated';
          report.paymentsAlreadyExist++;
        } else {
          await store.setJSON(paymentKey, paymentRecord);

          // Add to payments list if not already there
          if (!paymentsList.includes(payment.id)) {
            paymentsList.push(payment.id);
            await store.setJSON('payments:list', paymentsList);
          }

          detail.paymentAction = 'Payment record created';
          report.paymentsRecorded++;
        }
      } catch (err) {
        const errMsg = `Error processing payment ${payment.id}: ${err.message}`;
        console.error('[razorpay-sync]', errMsg);
        report.errors.push(errMsg);
        detail.userAction = 'ERROR: ' + err.message;
      }

      report.details.push(detail);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, report }),
    };
  } catch (err) {
    console.error('[/razorpay/sync] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Sync failed: ' + err.message }) };
  }
};