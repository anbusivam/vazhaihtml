// Netlify Function: GET/POST /bank/transactions
// Admin only: Import bank transactions from CSV and list them.
// 
// POST /bank/transactions — Import bank transactions from CSV text.
//   Body: { csv: "..." } — raw CSV text
//   The function finds the header row containing the required columns:
//     TRAN DATE, VALUE DATE, NARRATION, CHQ.NO., WITHDRAWAL(DR), DEPOSIT(CR)
//   If any required column is missing, returns an error message.
//   Uses NARRATION as the unique key for each transaction.
//
// GET /bank/transactions — List all imported bank transactions.
//   Returns array of transaction objects, plus existingPaymentIds array
//   so the client can verify whether a payment ID actually exists in the blob store.

const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getBankStore } = require('./bank-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Required columns for bank transaction import
const REQUIRED_COLUMNS = [
  'TRAN DATE',
  'VALUE DATE',
  'NARRATION',
  'CHQ.NO.',
  'WITHDRAWAL(DR)',
  'DEPOSIT(CR)',
];

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
 * Normalize a column header for comparison.
 * Lowercase, strip non-alphanumeric characters.
 */
function normalizeHeader(header) {
  return String(header).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parse CSV text into rows of arrays.
 * Handles quoted values properly.
 */
function parseCSVLines(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
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
    rows.push(values);
  }
  return rows;
}

/**
 * Find the header row index in the CSV that contains the required bank transaction columns.
 * The bank statement CSV has many header rows before the actual data table.
 * Returns the index of the header row, or -1 if not found.
 */
function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const normalized = row.map(normalizeHeader);
    
    // Check if this row contains the required columns
    const requiredNormalized = REQUIRED_COLUMNS.map(normalizeHeader);
    const foundCount = requiredNormalized.filter(col => normalized.includes(col)).length;
    
    // We need ALL required columns in the same row
    if (foundCount === requiredNormalized.length) {
      return i;
    }
  }
  return -1;
}

/**
 * Map a row of values to an object using the header row.
 */
function mapRowToObject(headers, values) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = (values[i] !== undefined) ? values[i] : '';
  }
  return obj;
}

/**
 * Extract the required fields from a parsed row object.
 * Returns null if the row is empty (no data).
 */
function extractTransaction(row) {
  const tranDate = row['TRAN DATE'] || '';
  const valueDate = row['VALUE DATE'] || '';
  const narration = row['NARRATION'] || '';
  const chqNo = row['CHQ.NO.'] || '';
  const withdrawal = row['WITHDRAWAL(DR)'] || '';
  const deposit = row['DEPOSIT(CR)'] || '';

  // Skip empty rows (all fields empty) OR rows without narration
  // Narration is the key for transactions, so rows without it are footer/header noise
  if ((!tranDate && !valueDate && !narration && !chqNo && !withdrawal && !deposit) || !narration.trim()) {
    return null;
  }

  return {
    tranDate,
    valueDate,
    narration,
    chqNo,
    withdrawal,
    deposit,
  };
}

/**
 * Generate a unique key from narration.
 * Uses the narration text as the base, with a hash suffix for uniqueness.
 */
function generateNarrationKey(narration, existingKeys) {
  // Clean the narration to make it a valid blob key
  let key = String(narration).trim();
  // Replace spaces and special chars with hyphens, keep alphanumeric
  key = key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  // Limit length
  if (key.length > 100) key = key.substring(0, 100);
  // If empty, use a fallback
  if (!key) key = 'txn';

  // Ensure uniqueness by appending a counter if needed
  let uniqueKey = key;
  let counter = 1;
  while (existingKeys.has(uniqueKey)) {
    uniqueKey = `${key}-${counter}`;
    counter++;
  }
  existingKeys.add(uniqueKey);
  return uniqueKey;
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

    // ─── GET: List all bank transactions ───
    if (event.httpMethod === 'GET') {
      const transactionsList = await bankStore.get('transactions:list', { type: 'json' }) || [];
      
      // Fetch each transaction record
      const transactions = [];
      for (const key of transactionsList) {
        try {
          const txn = await bankStore.get(`transaction:${key}`, { type: 'json' });
          if (txn) {
            transactions.push(txn);
          }
        } catch (_) {
          // Skip corrupt records
        }
      }

      // Sort by tranDate descending (newest first)
      transactions.sort((a, b) => {
        const dateA = new Date(a.tranDate.split('/').reverse().join('-'));
        const dateB = new Date(b.tranDate.split('/').reverse().join('-'));
        return dateB - dateA;
      });

      // Fetch the list of existing payment IDs from the auth store
      // so the client can detect orphan payment IDs
      const existingPaymentIds = await store.get('payments:list', { type: 'json' }) || [];

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          transactions,
          count: transactions.length,
          existingPaymentIds,
        }),
      };
    }

    // ─── POST: Import bank transactions from CSV ───
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { csv } = body;

      if (!csv || typeof csv !== 'string' || csv.trim().length === 0) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'CSV content is required. Send { csv: "..." }' }) };
      }

      // Parse CSV into rows
      const rows = parseCSVLines(csv);
      if (rows.length === 0) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'CSV file is empty.' }) };
      }

      // Find the header row containing required columns
      const headerRowIdx = findHeaderRow(rows);
      if (headerRowIdx === -1) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: `Required columns not found in CSV. Expected columns: ${REQUIRED_COLUMNS.join(', ')}. The CSV structure may be different — please ensure the file contains a row with these exact column headers.`,
          }),
        };
      }

      const headers = rows[headerRowIdx];
      const normalizedHeaders = headers.map(normalizeHeader);

      // Verify all required columns are present
      const missingColumns = [];
      for (const col of REQUIRED_COLUMNS) {
        const normCol = normalizeHeader(col);
        if (!normalizedHeaders.includes(normCol)) {
          missingColumns.push(col);
        }
      }

      if (missingColumns.length > 0) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: `Missing required column(s): ${missingColumns.join(', ')}. The CSV must contain these columns: ${REQUIRED_COLUMNS.join(', ')}.`,
          }),
        };
      }

      // Parse data rows (after the header row)
      const dataRows = [];
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const rowObj = mapRowToObject(headers, rows[i]);
        const txn = extractTransaction(rowObj);
        if (txn) {
          dataRows.push(txn);
        }
      }

      if (dataRows.length === 0) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No valid transaction data found in CSV after the header row.' }) };
      }

      // Get existing transactions list
      const transactionsList = await bankStore.get('transactions:list', { type: 'json' }) || [];
      const existingKeys = new Set(transactionsList);

      // Also load existing transaction narrations to check for duplicates
      const existingNarrations = new Set();
      for (const key of transactionsList) {
        try {
          const txn = await bankStore.get(`transaction:${key}`, { type: 'json' });
          if (txn && txn.narration) {
            existingNarrations.add(txn.narration.trim());
          }
        } catch (_) {}
      }

      // Import transactions
      const results = { inserted: 0, skipped: 0, errors: [] };
      const newKeys = [];

      for (const txn of dataRows) {
        try {
          // Check for duplicate narration (skip if already exists)
          const narrationKey = txn.narration.trim();
          if (existingNarrations.has(narrationKey)) {
            results.skipped++;
            continue;
          }

          // Generate a unique key from narration
          const key = generateNarrationKey(narrationKey, existingKeys);
          
          // Add metadata
          const record = {
            ...txn,
            key,
            importedAt: new Date().toISOString(),
            importedBy: session.email,
          };

          await bankStore.setJSON(`transaction:${key}`, record);
          existingNarrations.add(narrationKey);
          newKeys.push(key);
          results.inserted++;
        } catch (err) {
          results.errors.push({ narration: txn.narration, error: err.message });
        }
      }

      // Update the transactions list
      if (newKeys.length > 0) {
        const updatedList = [...transactionsList, ...newKeys];
        await bankStore.setJSON('transactions:list', updatedList);
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          result: results,
          message: `✅ ${results.inserted} transaction(s) imported, ${results.skipped} duplicate(s) skipped. ${results.errors.length} error(s).`,
        }),
      };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use GET (list) or POST (import).' }) };

  } catch (err) {
    console.error('[/bank/transactions] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};