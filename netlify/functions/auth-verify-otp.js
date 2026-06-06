// Netlify Function: POST /auth/verify-otp
// Verifies OTP, creates a session cookie, stores session locally
const { getStore } = require('./auth-store');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_ATTEMPTS = 5;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, otp } = JSON.parse(event.body || '{}');

    if (!email || !otp) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Email and OTP are required.' }) };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const store = await getStore(context);

    // Get OTP
    const otpData = await store.get(`otp:${normalizedEmail}`, { type: 'json' });

    if (!otpData) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No OTP found. Please request a new one.' }) };
    }
    if (otpData.expiresAt && Date.now() > otpData.expiresAt) {
      await store.delete(`otp:${normalizedEmail}`);
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'OTP has expired. Please request a new one.' }) };
    }
    if (otpData.attempts >= MAX_ATTEMPTS) {
      await store.delete(`otp:${normalizedEmail}`);
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Too many failed attempts. Please request a new OTP.' }) };
    }

    if (otpData.otp !== otp) {
      otpData.attempts += 1;
      await store.setJSON(`otp:${normalizedEmail}`, otpData);
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid OTP. Please try again.' }) };
    }

    // OTP verified — delete it
    await store.delete(`otp:${normalizedEmail}`);

    // Create session token
    const token = generateToken();
    const expiresAt = Date.now() + SESSION_DURATION_MS;

    await store.setJSON(`session:${token}`, {
      email: normalizedEmail,
      expiresAt,
      createdAt: Date.now(),
    });

    // Store/update user
    const userData = await store.get(`user:${normalizedEmail}`, { type: 'json' });
    if (!userData) {
      await store.setJSON(`user:${normalizedEmail}`, {
        email: normalizedEmail,
        firstLogin: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      });
    } else {
      userData.lastLogin = new Date().toISOString();
      await store.setJSON(`user:${normalizedEmail}`, userData);
    }

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Set-Cookie': `vazhai_session=${token}; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}; SameSite=Lax`,
      },
      body: JSON.stringify({
        success: true,
        token,
        email: normalizedEmail,
        message: 'Login successful.',
      }),
    };
  } catch (err) {
    console.error('[auth-verify-otp] Exception:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error. Please try again.' }) };
  }
};