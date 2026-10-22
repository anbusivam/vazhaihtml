// Netlify Function: /feedback
// Public submission endpoint and admin moderation API.
const crypto = require('crypto');
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MAX_MESSAGE_LENGTH = 3000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const CATEGORIES = new Set(['vazhai', 'website']);

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function getToken(event) {
  const cookies = event.headers.cookie || event.headers.Cookie || '';
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const match = cookies.match(/vazhai_session=([^;]+)/);
  if (match) return match[1];
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

async function getSession(store, event) {
  const token = getToken(event);
  if (!token) return null;
  const session = await store.get(`session:${token}`, { type: 'json' });
  if (!session || !session.email || Date.now() > session.expiresAt) return null;
  return session;
}

async function getAdminSession(store, event) {
  const session = await getSession(store, event);
  if (!session) return null;
  if (ADMIN_EMAILS.includes(session.email)) return session;
  const userData = await store.get(`user:${session.email}`, { type: 'json' });
  const roles = userData && Array.isArray(userData.roles)
    ? userData.roles
    : (userData && userData.role ? [userData.role] : []);
  if (!roles.includes('admin')) return null;
  return session;
}

function getClientIp(event) {
  const forwarded = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'] || '';
  return forwarded.split(',')[0].trim() || event.headers['client-ip'] || 'unknown';
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

async function checkRateLimit(store, event) {
  const key = `feedback:rate:${hashValue(getClientIp(event))}`;
  const now = Date.now();
  const record = await store.get(key, { type: 'json' });
  const current = record && record.windowStart && now - record.windowStart < RATE_WINDOW_MS
    ? record
    : { windowStart: now, count: 0 };

  if (current.count >= RATE_LIMIT) return false;
  current.count += 1;
  await store.setJSON(key, current);
  return true;
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (_) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendNotification(feedback) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const fields = [
    ['Category', feedback.category],
    ['Identity', feedback.identityType],
    ['Name', feedback.name || 'Anonymous'],
    ['Email', feedback.email || 'Not provided'],
    ['Page', feedback.pageUrl || 'Not provided'],
    ['Message', feedback.message],
  ];
  const text = fields.map(([label, value]) => `${label}: ${value}`).join('\n');
  const html = fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</p>`).join('');
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.FEEDBACK_NOTIFICATION_FROM || process.env.OTP_FROM_EMAIL || 'do-not-reply@vazhai.in',
      to: [process.env.FEEDBACK_NOTIFICATION_TO || 'vazhai.connect@gmail.com'],
      reply_to: feedback.email || undefined,
      subject: `New Vazhai feedback: ${feedback.category}`,
      text,
      html: `<h2>New Vazhai feedback</h2>${html}`,
    }),
  });
  if (!resendResponse.ok) throw new Error(`Resend returned ${resendResponse.status}: ${await resendResponse.text()}`);
}

async function handleSubmit(store, event) {
  if (!(await checkRateLimit(store, event))) {
    return response(429, { error: 'Too many submissions. Please try again later.' });
  }

  const body = parseBody(event);
  if (!body) return response(400, { error: 'Invalid JSON body.' });

  const category = String(body.category || '').trim().toLowerCase();
  const message = String(body.message || '').trim();
  const identityType = String(body.identityType || 'anonymous').trim().toLowerCase();

  if (!CATEGORIES.has(category)) return response(400, { error: 'Choose a valid feedback category.' });
  if (!message) return response(400, { error: 'Feedback message is required.' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return response(400, { error: `Feedback must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
  }
  if (!['authenticated', 'guest', 'anonymous'].includes(identityType)) {
    return response(400, { error: 'Choose a valid identity option.' });
  }

  const session = await getSession(store, event);
  const feedback = {
    id: crypto.randomUUID(),
    category,
    message,
    identityType,
    pageUrl: typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 500) : '',
    status: 'open',
    createdAt: new Date().toISOString(),
  };

  if (identityType === 'authenticated') {
    if (!session) return response(401, { error: 'Please log in to use your account identity.' });
    const userData = await store.get(`user:${session.email}`, { type: 'json' });
    if (!userData) return response(409, { error: 'Your account needs one more login before submitting feedback.' });
    if (!userData.userId) {
      userData.userId = crypto.randomUUID();
      await store.setJSON(`user:${session.email}`, userData);
    }
    feedback.userId = userData.userId;
    feedback.name = String(userData.name || session.email.split('@')[0]).slice(0, 120);
    feedback.email = session.email;
  } else if (identityType === 'guest') {
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (!name || name.length > 120) return response(400, { error: 'Enter a name of 120 characters or fewer.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return response(400, { error: 'Enter a valid email address.' });
    }
    feedback.name = name;
    feedback.email = email;
  }

  await store.setJSON(`feedback:item:${feedback.id}`, feedback);
  const index = await store.get('feedback:index', { type: 'json' }) || [];
  index.unshift(feedback.id);
  await store.setJSON('feedback:index', index.slice(0, 5000));
  try {
    await sendNotification(feedback);
  } catch (error) {
    console.error('[feedback] Notification failed:', error.message);
  }

  return response(201, { ok: true, message: 'Thank you. Your feedback has been received.' });
}

async function handleList(store, event) {
  if (!(await getAdminSession(store, event))) return response(403, { error: 'Admin access required.' });
  const index = await store.get('feedback:index', { type: 'json' }) || [];
  const feedback = [];
  for (const id of index) {
    const item = await store.get(`feedback:item:${id}`, { type: 'json' });
    if (item) {
      if (item.status === 'pending' || item.status === 'approved') item.status = 'open';
      feedback.push(item);
    }
  }
  return response(200, { feedback });
}

async function handleStatus(store, event, body = parseBody(event)) {
  if (!(await getAdminSession(store, event))) return response(403, { error: 'Admin access required.' });
  const id = String(body && body.id || '').trim();
  const status = String(body && body.status || '').trim().toLowerCase();
  if (!id || !['open', 'resolved', 'rejected'].includes(status)) {
    return response(400, { error: 'A valid feedback ID and status are required.' });
  }
  const item = await store.get(`feedback:item:${id}`, { type: 'json' });
  if (!item) return response(404, { error: 'Feedback not found.' });
  item.status = status;
  item.updatedAt = new Date().toISOString();
  await store.setJSON(`feedback:item:${id}`, item);
  return response(200, { ok: true, feedback: item });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return response(204, {});

  try {
    const store = await getStore(event);
    const path = event.path || '';
    const body = event.httpMethod === 'POST' ? parseBody(event) : null;
    if (event.httpMethod === 'POST' && (path.endsWith('/status') || body?.action === 'status')) {
      return await handleStatus(store, event, body);
    }
    if (event.httpMethod === 'GET') return await handleList(store, event);
    if (event.httpMethod === 'POST') return await handleSubmit(store, event);
    return response(405, { error: 'Method not allowed.' });
  } catch (err) {
    console.error('[feedback] Exception:', err.message, err.stack);
    return response(500, { error: 'Server error. Please try again.' });
  }
};
