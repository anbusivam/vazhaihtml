// Netlify Function: GET/POST/DELETE /bank/narration-mapping
// Admin only: Manage narration pattern → user mappings and link bank transactions to users.
//
// GET /bank/narration-mapping — List all narration pattern → user mappings.
//
// POST /bank/narration-mapping
//   Body: { action: 'save', narration, regexPattern, userId, transactionKey (optional) }
//     — Validates regex matches narration, validates user exists,
//       saves the mapping, and optionally links the bank transaction to the user.
//   Body: { action: 'update', mappingKey, narration, regexPattern, userId }
//     — Updates an existing mapping's fields.
//   Body: { action: 'link', transactionKey, userId }
//     — Links a bank transaction to an existing user without saving a new mapping.
//   Body: { action: 'delete', mappingKey }
//     — Deletes a narration pattern mapping by key.
//
// DELETE /bank/narration-mapping?key=xxx — Delete a narration pattern mapping by key.

const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getBankStore } = require('./bank-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

/**
 * Compile a regex pattern, supporting the PCRE inline (?i) case-insensitive flag.
 * JavaScript doesn't support (?i) natively, so we strip it and use the 'i' flag.
 */
function compileRegex(pattern) {
  let flags = '';
  let cleanPattern = pattern;
  
  // Handle inline (?i) flag - remove all occurrences and add 'i' flag
  if (cleanPattern.includes('(?i)')) {
    cleanPattern = cleanPattern.replace(/\(\?i\)/g, '');
    flags += 'i';
  }
  
  return new RegExp(cleanPattern, flags);
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

    // ─── DELETE: Delete a narration pattern mapping by key ───
    if (event.httpMethod === 'DELETE') {
      const url = new URL(event.url, 'http://localhost');
      const mappingKey = url.searchParams.get('key');

      if (!mappingKey) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Mapping key is required.' }) };
      }

      // Check if the mapping exists
      const mapping = await bankStore.get(`narration-mapping:${mappingKey}`, { type: 'json' });
      if (!mapping) {
        return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Mapping not found.' }) };
      }

      // Delete the mapping record
      await bankStore.delete(`narration-mapping:${mappingKey}`);

      // Remove from the mappings list
      const mappingsList = await bankStore.get('narration-mapping:list', { type: 'json' }) || [];
      const updatedList = mappingsList.filter(k => k !== mappingKey);
      await bankStore.setJSON('narration-mapping:list', updatedList);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          message: `✅ Mapping "${mapping.narration || mappingKey}" deleted successfully.`,
        }),
      };
    }

    // ─── POST: Save/Update/Link/Delete ───
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      // ── action: 'save' — save a new narration pattern → user mapping and optionally link the txn ──
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

        // Validate regex compiles
        let regex;
        try {
          regex = compileRegex(regexPattern);
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

        // Optionally link the transaction to the user
        let txn = null;
        if (transactionKey) {
          txn = await bankStore.get(`transaction:${transactionKey}`, { type: 'json' });
          if (!txn) {
            return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Bank transaction not found.' }) };
          }
          txn.linkedUserId = normalizedUserId;
          txn.linkedUserName = userData ? userData.name || '' : '';
          txn.linkedPhone = userData ? userData.phone || '' : '';
          txn.linkedAt = new Date().toISOString();
          txn.linkedBy = session.email;
          await bankStore.setJSON(`transaction:${txn.key}`, txn);
        }

        const msg = transactionKey
          ? `✅ Narration pattern saved and transaction linked to ${userData && userData.name ? userData.name : normalizedUserId}.`
          : `✅ Narration pattern saved and mapped to ${userData && userData.name ? userData.name : normalizedUserId}.`;

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            mapping,
            transaction: txn,
            message: msg,
          }),
        };
      }

      // ── action: 'update' — update an existing mapping ──
      if (action === 'update') {
        const { mappingKey, narration, regexPattern, userId } = body;

        if (!mappingKey) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Mapping key is required.' }) };
        }
        if (!narration || typeof narration !== 'string' || narration.trim() === '') {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Narration is required.' }) };
        }
        if (!regexPattern || typeof regexPattern !== 'string' || regexPattern.trim() === '') {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Regex pattern is required.' }) };
        }
        if (!userId || typeof userId !== 'string') {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'User ID (email) is required.' }) };
        }

        // Check if the mapping exists
        const existingMapping = await bankStore.get(`narration-mapping:${mappingKey}`, { type: 'json' });
        if (!existingMapping) {
          return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Mapping not found.' }) };
        }

        // Validate regex compiles
        let regex;
        try {
          regex = compileRegex(regexPattern);
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

        // Update the mapping
        existingMapping.narration = narration;
        existingMapping.regexPattern = regexPattern;
        existingMapping.userId = normalizedUserId;
        existingMapping.userName = userData ? userData.name || '' : '';
        existingMapping.userPhone = userData ? userData.phone || '' : '';
        existingMapping.updatedAt = new Date().toISOString();
        existingMapping.updatedBy = session.email;

        await bankStore.setJSON(`narration-mapping:${mappingKey}`, existingMapping);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            mapping: { ...existingMapping, key: mappingKey },
            message: `✅ Mapping updated successfully.`,
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

      // ── action: 'delete' — delete a narration pattern mapping ──
      if (action === 'delete') {
        const { mappingKey } = body;

        if (!mappingKey) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Mapping key is required.' }) };
        }

        // Check if the mapping exists
        const mapping = await bankStore.get(`narration-mapping:${mappingKey}`, { type: 'json' });
        if (!mapping) {
          return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Mapping not found.' }) };
        }

        // Delete the mapping record
        await bankStore.delete(`narration-mapping:${mappingKey}`);

        // Remove from the mappings list
        const mappingsList = await bankStore.get('narration-mapping:list', { type: 'json' }) || [];
        const updatedList = mappingsList.filter(k => k !== mappingKey);
        await bankStore.setJSON('narration-mapping:list', updatedList);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            message: `✅ Mapping "${mapping.narration || mappingKey}" deleted successfully.`,
          }),
        };
      }

      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action. Use "save", "update", "link", or "delete".' }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use GET (list), POST (save/update/link/delete), or DELETE (delete).' }) };
  } catch (err) {
    console.error('[/bank/narration-mapping] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};