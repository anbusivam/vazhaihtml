// Netlify Function: POST /auth/verify-otp
// Verifies OTP (stateless via HMAC-signed token), creates a session cookie, stores session locally
const { getStore, ADMIN_EMAILS } = require('./auth-store');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_ATTEMPTS = 5;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_DURATION_MS = 10 * 60 * 1000; // 10 minutes

/** Verify an HMAC-signed OTP token (stateless — no blob storage needed for OTP) */
function verifyOtpToken(token, email, otp) {
  // Derive the signing key from an app secret (must be set in env)
  const secret = process.env.OTP_SIGNING_SECRET || process.env.SITE_ID || 'vazhai-dev-fallback-key';
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'Malformed token' };

  const [payloadB64, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return { valid: false, reason: 'Invalid token signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    return { valid: false, reason: 'Invalid token payload' };
  }

  // Validate payload fields
  if (payload.email !== email) return { valid: false, reason: 'Email mismatch' };
  if (payload.otp !== otp) return { valid: false, reason: 'Invalid OTP' };
  if (payload.expiresAt && Date.now() > payload.expiresAt) return { valid: false, reason: 'OTP has expired. Please request a new one.' };

  return { valid: true, data: payload };
}

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
    const { email, otp, otp_token } = JSON.parse(event.body || '{}');

    if (!email || !otp) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Email and OTP are required.' }) };
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── Primary path: stateless OTP verification via signed token ──────────
    if (otp_token) {
      const result = verifyOtpToken(otp_token, normalizedEmail, otp);
      if (!result.valid) {
        console.log('[auth-verify-otp] Token verification failed:', result.reason);
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: result.reason }) };
      }
      // OTP verified via token — proceed to create session
      console.log('[auth-verify-otp] OTP verified via signed token for', normalizedEmail);
    } else {
      // ── Fallback: blob-based OTP verification (for backward compatibility) ──
      console.log('[auth-verify-otp] No otp_token provided, falling back to blob store');
      const store = await getStore(event);

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

      // OTP verified — delete the stored OTP
      await store.delete(`otp:${normalizedEmail}`);
    }

    // ── Session creation (shared by both paths) ──
    const store = await getStore(event);
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
      // Determine role: admin if in ADMIN_EMAILS list
      const role = ADMIN_EMAILS.includes(normalizedEmail) ? 'admin' : null;
      await store.setJSON(`user:${normalizedEmail}`, {
        email: normalizedEmail,
        role: role,
        firstLogin: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      });

      // Add to users list for admin dashboard listing
      const usersList = await store.get('users:list', { type: 'json' }) || [];
      if (!usersList.includes(normalizedEmail)) {
        usersList.push(normalizedEmail);
        await store.setJSON('users:list', usersList);
      }
    } else {
      // For existing users, ensure admin role is set if they're in the admin list
      if (ADMIN_EMAILS.includes(normalizedEmail) && userData.role !== 'admin') {
        userData.role = 'admin';
      }
      // Also ensure user is in the users list
      const usersList = await store.get('users:list', { type: 'json' }) || [];
      if (!usersList.includes(normalizedEmail)) {
        usersList.push(normalizedEmail);
        await store.setJSON('users:list', usersList);
      }
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