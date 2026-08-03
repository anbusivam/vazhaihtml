// Netlify Function: POST /donor-wall/build
// Admin only: Scans the last 365 days of captured payments, aggregates per donor,
// excludes users on the permanent 'donor-wall-excluded' list, and writes the
// sanitized 'donor-wall' blob used by the public /donor-wall endpoint.
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const WINDOW_DAYS = 365;
const MAX_DONORS = 200;

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

// Sanitize a donor name to: first name + last initial  → "Priya R."
// Falls back to "Anonymous" if the name can't be parsed.
function sanitizeName(rawName) {
  if (!rawName || !rawName.trim()) return 'Anonymous';
  const parts = rawName.trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length === 1) {
    // Single word — show full name if short, else first 2 chars + '.'
    const single = parts[0];
    if (single.length <= 12) return single;
    return single.charAt(0).toUpperCase() + '.';
  }
  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return (first + ' ' + lastInitial + '.').trim();
}

// Format a timestamp as "Jan 2026"
function formatMonth(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

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

    // ── Load the permanent exclusion list ──
    // This is a blob containing an array of { email, name, excludedAt, excludedBy }
    // It persists forever — users remain excluded even beyond the 1-year window.
    const excludedObj = await store.get('donor-wall-excluded', { type: 'json' });
    let excludedList = [];
    if (excludedObj && Array.isArray(excludedObj.excluded)) {
      excludedList = excludedObj.excluded;
    }
    const excludedEmails = new Set(excludedList.map(e => (e.email || '').toLowerCase().trim()));

    // ── Load all payment IDs ──
    const paymentsList = await store.get('payments:list', { type: 'json' }) || [];

    // ── Compute the window (last 365 days) ──
    const now = Date.now();
    const windowStartTs = Math.floor((now - WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);

    // ── Aggregate per email ──
    const byEmail = new Map();
    let skippedExcluded = 0;
    let skippedNotCaptured = 0;
    let skippedOutsideWindow = 0;
    let skippedInvalid = 0;

    for (const paymentId of paymentsList) {
      try {
        const p = await store.get(`payment:${paymentId}`, { type: 'json' });
        if (!p) { skippedInvalid++; continue; }

        if (p.status !== 'captured') { skippedNotCaptured++; continue; }
        if (!p.amount || p.amount <= 0) { skippedInvalid++; continue; }

        const createdAt = p.createdAt || (p.createdAtDate ? Math.floor(new Date(p.createdAtDate).getTime() / 1000) : null);
        if (!createdAt || createdAt < windowStartTs) { skippedOutsideWindow++; continue; }

        const email = (p.email || p.donorEmail || '').toLowerCase().trim();
        if (!email) { skippedInvalid++; continue; }
        if (excludedEmails.has(email)) { skippedExcluded++; continue; }

        const existing = byEmail.get(email);
        if (existing) {
          existing.totalAmount = (existing.totalAmount || 0) + (p.amount || 0);
          existing.count = (existing.count || 0) + 1;
          // Keep the newest donorName / comment / date
          if (createdAt > (existing.lastTs || 0)) {
            existing.lastTs = createdAt;
            existing.rawName = p.donorName || existing.rawName;
            existing.comment = p.donorComment || existing.comment;
          }
        } else {
          byEmail.set(email, {
            email,
            rawName: p.donorName || '',
            comment: p.donorComment || '',
            totalAmount: p.amount || 0,
            count: 1,
            lastTs: createdAt,
          });
        }
      } catch (_) {
        skippedInvalid++;
      }
    }

    // ── Build the donor-wall blob ──
    const donors = [...byEmail.values()]
      .sort((a, b) => b.lastTs - a.lastTs)               // newest first = "news"
      .slice(0, MAX_DONORS)
      .map(d => ({
        name: sanitizeName(d.rawName),
        message: (d.comment || '').trim() || '',
        month: formatMonth(d.lastTs),
        // Admin-only fields — stripped by /donor-wall before public UI
        email: d.email,
        totalAmount: Math.round(d.totalAmount * 100) / 100,
        count: d.count,
      }));

    const wall = {
      updated: new Date().toISOString(),
      builtBy: session.email,
      windowDays: WINDOW_DAYS,
      excludedCount: excludedList.length,
      donors,
    };

    await store.setJSON('donor-wall', wall);

    // ── Summary for the admin UI ──
    const totalWallAmount = donors.reduce((s, d) => s + (d.totalAmount || 0), 0);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        builtAt: wall.updated,
        windowDays: WINDOW_DAYS,
        donorsCount: donors.length,
        totalAmount: Math.round(totalWallAmount * 100) / 100,
        excludedCount: excludedList.length,
        aggregate: {
          totalPaymentsScanned: paymentsList.length,
          skippedNotCaptured,
          skippedOutsideWindow,
          skippedExcluded,
          skippedInvalid,
        },
      }),
    };
  } catch (err) {
    console.error('[/donor-wall/build] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to build donor wall: ' + err.message }) };
  }
};