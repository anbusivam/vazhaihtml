// Netlify Function: POST /expense/upload
// Admin only: Upload a document (voucher/bill) for an expense record.
// Stores the document in the expense blob store.
//
// Body: multipart/form-data with:
//   expenseKey — the expense key to attach the document to
//   file       — the document file (PDF, image, etc.)
//
// Returns the document metadata (id, filename, contentType, size, url).

const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getExpenseStore } = require('./expense-store');
const crypto = require('crypto');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || '';
const CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Maximum file size: 1 MB
const MAX_FILE_SIZE = 1 * 1024 * 1024;

// Expense attachments are image-only bills and vouchers.
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
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

// Simple multipart form-data parser for Node.js
function parseMultipart(buffer, boundary) {
  const boundaryBytes = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const bIdx = buffer.indexOf(boundaryBytes, start);
    if (bIdx === -1) break;

    const partStart = bIdx + boundaryBytes.length;

    // Check if this is the closing boundary
    if (buffer[partStart] === 0x2d && buffer[partStart + 1] === 0x2d) break;

    // Skip \r\n after boundary
    let contentStart = partStart;
    if (buffer[contentStart] === 0x0d) contentStart += 1;
    if (buffer[contentStart] === 0x0a) contentStart += 1;

    // Find double \r\n separating headers from body
    const headerEnd = buffer.indexOf('\r\n\r\n', contentStart);
    if (headerEnd === -1) break;

    const headerSection = buffer.slice(contentStart, headerEnd).toString('utf-8');
    const dataStart = headerEnd + 4;

    // Find next boundary to know where this part ends
    const nextBIdx = buffer.indexOf(boundaryBytes, dataStart);
    const partEnd = nextBIdx !== -1 ? nextBIdx - 2 : buffer.length;

    // Parse headers
    const fieldName = extractHeaderValue(headerSection, 'name');
    const filename = extractHeaderValue(headerSection, 'filename');
    const contentType = extractContentType(headerSection);

    parts.push({
      fieldName,
      filename,
      contentType,
      data: buffer.slice(dataStart, partEnd),
    });

    start = nextBIdx !== -1 ? nextBIdx + boundaryBytes.length : buffer.length;
  }

  return parts;
}

function extractHeaderValue(headerSection, attr) {
  const regex = new RegExp(`${attr}="([^"]*)"`);
  const match = headerSection.match(regex);
  return match ? match[1] : null;
}

function extractContentType(headerSection) {
  const match = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}

function sanitizeFilename(filename) {
  if (!filename) return 'document';
  // Remove path components and dangerous characters
  const base = String(filename).split(/[\\/]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100) || 'document';
}

function sanitizeFolderPart(value) {
  return String(value || 'expense')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80) || 'expense';
}

async function uploadToCloudinary(file, filename, expenseKey, publicId) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_KEY || !CLOUDINARY_SECRET) {
    throw new Error('Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_KEY, and CLOUDINARY_SECRET env vars.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `expense-documents/${sanitizeFolderPart(expenseKey)}`;
  const resourceType = file.contentType.startsWith('image/') ? 'image' : 'raw';
  const paramsToSign = { folder, public_id: publicId, timestamp };
  const signString = Object.keys(paramsToSign)
    .sort()
    .map(key => `${key}=${paramsToSign[key]}`)
    .join('&') + CLOUDINARY_SECRET;
  const signature = crypto.createHash('sha1').update(signString).digest('hex');
  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

  const fields = [
    ['api_key', CLOUDINARY_KEY],
    ['timestamp', timestamp],
    ['folder', folder],
    ['public_id', publicId],
    ['signature', signature],
  ];
  const parts = fields.map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  );
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`
  );

  const requestBody = Buffer.concat([
    ...parts.map(part => Buffer.from(part, 'utf-8')),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
  ]);
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: requestBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[/expense/upload] Cloudinary error:', response.status, errorText);
    throw new Error('Cloudinary upload failed.');
  }

  return response.json();
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);
    if (!session) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!ADMIN_EMAILS.includes(session.email)) return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use POST.' }) };

    const contentType = event.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expected multipart/form-data' }) };
    }

    // Parse the multipart body
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body);

    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No boundary in content-type' }) };
    }

    const parts = parseMultipart(bodyBuffer, boundary.trim());
    const expenseKeyPart = parts.find(p => p.fieldName === 'expenseKey');
    const filePart = parts.find(p => p.fieldName === 'file');

    if (!expenseKeyPart || !expenseKeyPart.data) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'expenseKey is required.' }) };
    }

    const expenseKey = expenseKeyPart.data.toString('utf-8').trim();
    if (!expenseKey) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'expenseKey is required.' }) };
    }

    if (!filePart || !filePart.data || filePart.data.length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No file found in upload.' }) };
    }

    // Check file size
    if (filePart.data.length >= MAX_FILE_SIZE) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Image is too large. Maximum size is 1 MB.' }) };
    }

    // Check file type
    const fileType = filePart.contentType || 'application/octet-stream';
    if (!ALLOWED_TYPES.includes(fileType)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `File type "${fileType}" is not allowed. Only JPEG, PNG, GIF, and WebP images are allowed.` }) };
    }

    const expenseStore = await getExpenseStore(event);

    // Verify the expense exists
    const expense = await expenseStore.get(`expense:${expenseKey}`, { type: 'json' });
    if (!expense) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Expense not found.' }) };
    }

    // Generate a unique document ID
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const filename = sanitizeFilename(filePart.filename);

    const uploadedAt = new Date().toISOString();
    const cloudinaryData = await uploadToCloudinary(
      { data: filePart.data, contentType: fileType },
      filename,
      expenseKey,
      docId
    );

    // Add document metadata to the expense record
    if (!expense.documents) expense.documents = [];
    const docMeta = {
      id: docId,
      filename,
      contentType: fileType,
      size: filePart.data.length,
      uploadedAt,
      uploadedBy: session.email,
      url: cloudinaryData.secure_url || cloudinaryData.url,
      storage: 'cloudinary',
      publicId: cloudinaryData.public_id,
      resourceType: cloudinaryData.resource_type,
    };
    expense.documents.push(docMeta);
    expense.lastEditedAt = new Date().toISOString();
    expense.lastEditedBy = session.email;
    await expenseStore.setJSON(`expense:${expenseKey}`, expense);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        document: docMeta,
        message: `✅ Document "${filename}" uploaded successfully.`,
      }),
    };
  } catch (err) {
    console.error('[/expense/upload] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};