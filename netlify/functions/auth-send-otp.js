// Netlify Function: POST /auth/send-otp
// Generates a 6-digit OTP, stores in Netlify Blobs, sends via Resend
const { getStore } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Valid email is required.' }) };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    // Store OTP
    const store = await getStore(context);
    await store.setJSON(`otp:${normalizedEmail}`, {
      otp,
      expiresAt,
      attempts: 0,
    });

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.OTP_FROM_EMAIL || 'do-not-reply@vazhai.in';

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: normalizedEmail,
        subject: 'Your Vazhai Login OTP',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h2 style="color: #4a7c59; margin: 0;">வாழை VAZHAI</h2>
              <p style="color: #666; font-size: 14px;">Rural Education · Tamil Nadu</p>
            </div>
            <div style="background: #f0f9f0; border-radius: 12px; padding: 32px; text-align: center;">
              <h3 style="color: #333; margin: 0 0 8px;">Login OTP</h3>
              <p style="color: #666; font-size: 14px; margin: 0 0 20px;">Use this code to log in to your account</p>
              <div style="background: white; border-radius: 8px; padding: 16px 32px; display: inline-block;">
                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2d5a3f;">${otp}</span>
              </div>
              <p style="color: #999; font-size: 12px; margin-top: 20px;">This code expires in 10 minutes</p>
              <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
            </div>
          </div>
        `,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('[auth-send-otp] Resend error:', JSON.stringify(resendData));
      // If Resend returns "domain not verified", log it clearly so the operator knows.
      const msg = resendData && resendData.message && resendData.message.includes('domain is not verified')
        ? 'Email service domain not verified. Please contact the site administrator.'
        : 'Failed to send email. Please try again.';
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) };
    }

    console.log('[auth-send-otp] OTP sent to', normalizedEmail, '- OTP:', otp);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, message: 'OTP sent to your email.' }),
    };
  } catch (err) {
    console.error('[auth-send-otp] Exception:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error. Please try again.' }) };
  }
};