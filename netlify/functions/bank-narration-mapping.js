// Netlify Function: GET/POST /bank/narration-mapping
// Admin only: Manage narration pattern → user mappings and link bank transactions to users.
//
// GET /bank/narration-mapping — List all narration pattern → user mappings.
//
// POST /bank/narration-mapping
//   Body: { action: 'save', narration, regexPattern, userId, transactionKey }
//     — Validates regex matches narration, validates user exists,
//       saves the mapping, and links the bank transaction to the user.
//   Body: { action: 'link', transactionKey, userId }
//     — Links a bank transaction to an existing user without saving a new mapping.

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

function generateMappingKey(narration) {
  let key = String(narration).trim();
  key = key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (key.length > 80) key = key.substring(0, 80);
  if (!key) key = 'mapping';
  return `${key}-${Date.now()}`;
}

async function getUserData(store, userId) {
  const normalized = String(userId).toLowerCase().trim();
  return await store.get(`user:${normalized}`, { type: 'json' });
}

async function checkUserExists(store, userId) {
  const usersList = await store.get('users:list', { type: 'json' }) || [];
  return usersList.includes(String(userId).toLowerCase().trim());
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

    // ─── GET: List narration pattern → user mappings ───
    if (event.httpMethod === 'GET') {
      const mappingsList = await bankStore.get('narration-mapping:list', { type: 'json' }) || [];

      const mappings = [];
      for (const key of mappingsList) {
        try {
          const mapping = await bankStore.get(`narration-mapping:${key}`, { type: 'json' });
          if (mapping) {
            mappings.push({ ...mapping, key });
          }
        } catch (_) {
          // Skip corrupt records
        }
      }

      // Sort by createdAt descending (newest first)
      mappings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, mappings, count: mappings.length }),
      };
    }

    // ─── POST: Save mapping + link, or link using existing mapping ───
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      // ── action: 'save' — save a new narration pattern → user mapping and link the txn ──
      if (action === 'save') {
        const { narration, regexPattern, userId, transactionKey } = body;

        if (!narration || typeof narration !== 'string' || narration.trim() === '') {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Narration is required.' }) };
        }
        if (!regexPattern || typeof regexPattern !== 'string' || regexPattern.trim() === '') {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Regex pattern is required.' }) };
        }
        if (!userId || typeof userId !== 'string') {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User ID (email) is required.' }) };
        }
        if (!transactionKey) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Transaction key is required.' }) };
        }

        // Validate regex compiles
        let regex;
        try {
          regex = new RegExp(regexPattern);
        } catch (err) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Invalid regex pattern: ${err.message}` }) };
        }

        // Validate regex matches the narration
        if (!regex.test(narration)) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'The regex pattern does not match the narration text.' }) };
        }

        // Validate user exists
        const normalizedUserId = String(userId).toLowerCase().trim();
        const userExists = await checkUserExists(store, normalizedUserId);
        if (!userExists) {
          return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User not found with ID: ' + userId }) };
        }

        const userData = await getUserData(store, normalizedUserId);

        // Load the transaction
        const txn = await bankStore.get(`transaction:${transactionKey}`, { type: 'json' });
        if (!txn) {
          return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Bank transaction not found.' }) };
        }

        // Create the mapping
        const mapping = {
          narration,
          regexPattern,
          userId: normalizedUserId,
          userName: userData ? userData.name || '' : '',
          userPhone: userData ? userData.phone || '' : '',
          createdAt: new Date().toISOString(),
          createdBy: session.email,
        };
        const mappingKey = generateMappingKey(narration);

        await bankStore.setJSON(`narration-mapping:${mappingKey}`, mapping);

        // Add to mappings list (dedupe)
        const mappingsList = await bankStore.get('narration-mapping:list', { type: 'json' }) || [];
        if (!mappingsList.includes(mappingKey)) {
          mappingsList.push(mappingKey);
          await bankStore.setJSON('narration-mapping:list', mappingsList);
        }

        // Link the transaction to the user
        txn.linkedUserId = normalizedUserId;
        txn.linkedUserName = userData ? userData.name || '' : '';
        txn.linkedPhone = userData ? userData.phone || '' : '';
        txn.linkedAt = new Date().toISOString();
        txn.linkedBy = session.email;
        await bankStore.setJSON(`transaction:${txn.key}`, txn);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            mapping,
            transaction: txn,
            message: `✅ Narration pattern saved and transaction linked to ${userData && userData.name ? userData.name : normalizedUserId}.`,
          }),
        };
      }

      // ── action: 'link' — link a transaction using an existing mapping (no new mapping saved) ──
      if (action === 'link') {
        const { transactionKey, userId } = body;

        if (!transactionKey) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Transaction key is required.' }) };
        }
        if (!userId || typeof userId !== 'string') {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User ID (email) is required.' }) };
        }

        // Validate user exists
        const normalizedUserId = String(userId).toLowerCase().trim();
        const userExists = await checkUserExists(store, normalizedUserId);
        if (!userExists) {
          return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User not found with ID: ' + userId }) };
        }

        const userData = await getUserData(store, normalizedUserId);

        // Load the transaction
        const txn = await bankStore.get(`transaction:${transactionKey}`, { type: 'json' });
        if (!txn) {
          return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Bank transaction not found.' }) };
        }

        // Link the transaction to the user
        txn.linkedUserId = normalizedUserId;
        txn.linkedUserName = userData ? userData.name || '' : '';
        txn.linkedPhone = userData ? userData.phone || '' : '';
        txn.linkedAt = new Date().toISOString();
        txn.linkedBy = session.email;
        await bankStore.setJSON(`transaction:${txn.key}`, txn);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            transaction: txn,
            message: `✅ Transaction linked to ${userData && userData.name ? userData.name : normalizedUserId}.`,
          }),
        };
      }

      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action. Use "save" or "link".' }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use GET (list) or POST (save/link).' }) };
  } catch (err) {
    console.error('[/bank/narration-mapping] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};