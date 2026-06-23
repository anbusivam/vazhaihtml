// Netlify Function: POST /razorpay/send-thank-letter
// Admin only: Sends a thank-you email via Resend for a successful payment.
// Updates the payment record with thankLetterSent field (Yes/No).
// Skips if thankLetterSent is already Yes, unless force flag is set (for resend).
const { getStore, ADMIN_EMAILS } = require('./auth-store');
const fs = require('fs');
const path = require('path');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const { paymentId, force } = JSON.parse(event.body || '{}');
    if (!paymentId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'paymentId is required.' }) };
    }

    // Fetch the payment record
    const payment = await store.get(`payment:${paymentId}`, { type: 'json' });
    if (!payment) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment record not found.' }) };
    }

    // ── Check if already sent (skip check if force resend) ──
    if (payment.thankLetterSent === 'Yes' && !force) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: 'ignored', message: 'Thank letter already sent for this payment.' }),
      };
    }
    if (payment.thankLetterSent === 'Yes' && force) {
      console.log('[razorpay-send-thank-letter] Force resend requested for payment', paymentId);
    }

    // Only send for successful (captured) payments
    if (payment.status !== 'captured') {
      // Update as "No" for failed payments (explicitly mark)
      await store.setJSON(`payment:${paymentId}`, { ...payment, thankLetterSent: 'No', thankLetterUpdatedAt: new Date().toISOString() });
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: 'ignored', message: 'Payment is not captured. Skipping thank letter.' }),
      };
    }

    // ── Prepare donor info ──
    const donorName = payment.donorName || payment.email || 'Donor';
    const donorEmail = payment.email || payment.donorEmail || '';
    const donationAmount = '₹' + Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 });

    // ── Format donation date from payment's createdAt timestamp ──
    let donationDate = '';
    if (payment.createdAt) {
      const ts = typeof payment.createdAt === 'number' ? payment.createdAt * 1000 : payment.createdAt;
      donationDate = new Date(ts).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } else {
      donationDate = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    }

    if (!donorEmail) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: 'error', message: 'Donor email is missing from payment record.' }),
      };
    }

    // ── Load the thank letter template ──
    // In Netlify Functions, __dirname points to the function's directory (netlify/functions/)
    // The template is at the project root, so we go up two levels
    const templatePath = path.resolve(__dirname, '..', '..', 'ThankLetterTemplate.html');
    let templateHtml;
    try {
      templateHtml = fs.readFileSync(templatePath, 'utf8');
    } catch (err) {
      console.error('[razorpay-send-thank-letter] Failed to read template:', err.message);
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ status: 'error', message: 'Failed to read thank letter template.' }) };
    }

    // ── Replace placeholders ──
    const emailHtml = templateHtml
      .replace(/\[donor-name\]/g, donorName)
      .replace(/\[donation-amount\]/g, donationAmount)
      .replace(/\[donation-date\]/g, donationDate)
      .replace(/\[donor-mail-id\]/g, donorEmail);

    // ── Send via Resend ──
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.THANKYOULETTER_FROM_EMAIL || 'vazhai.in@vazhai.in';
    const replyToEmail = process.env.THANKYOULETTER_REPLYTO_EMAIL || 'vazhai.connect@gmail.com';

    if (!resendApiKey) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ status: 'error', message: 'Resend API key not configured.' }) };
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: donorEmail,
        cc: 'vazhai.connect@gmail.com',
        subject: 'Thank You for Your Donation — Vazhai',
        html: emailHtml,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('[razorpay-send-thank-letter] Resend error:', JSON.stringify(resendData));
      // Update payment record: thank letter failed
      await store.setJSON(`payment:${paymentId}`, {
        ...payment,
        thankLetterSent: 'No',
        thankLetterUpdatedAt: new Date().toISOString(),
        thankLetterError: resendData.message || 'Resend API error',
      });
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: 'error',
          message: 'Failed to send email: ' + (resendData.message || 'Unknown error'),
        }),
      };
    }

    // ── Success: update payment record ──
    await store.setJSON(`payment:${paymentId}`, {
      ...payment,
      thankLetterSent: 'Yes',
      thankLetterUpdatedAt: new Date().toISOString(),
      thankLetterSentBy: session.email,
    });

    console.log('[razorpay-send-thank-letter] Thank letter sent to', donorEmail, 'for payment', paymentId);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: 'thanked',
        message: 'Thank you letter sent successfully to ' + donorEmail,
      }),
    };

  } catch (err) {
    console.error('[/razorpay/send-thank-letter] Error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: 'error', message: 'Server error: ' + err.message }),
    };
  }
};