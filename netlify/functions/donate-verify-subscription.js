// Netlify Function: POST /donate/verify-subscription
// Verifies Razorpay subscription payment signature
const crypto = require('crypto');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = JSON.parse(event.body || '{}');

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing subscription verification fields.' }) };
    }

    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzpKeySecret) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server config error: missing Razorpay secret.' }) };
    }

    const expected = crypto
      .createHmac('sha256', rzpKeySecret)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Subscription signature mismatch. Could not be verified.' }) };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, paymentId: razorpay_payment_id }),
    };
  } catch (err) {
    console.error('[/donate/verify-subscription]', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Verification failed. Please contact us with your payment ID.' }) };
  }
};