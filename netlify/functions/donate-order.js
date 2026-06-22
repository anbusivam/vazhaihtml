// Netlify Function: POST /donate/order
// Creates a Razorpay Order for one-time payment
const Razorpay = require('razorpay');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ONE_TIME_MIN_AMOUNT = 500;

// Build donor notes object
function buildNotes(donor) {
  return {
    donor: JSON.stringify({
      name:    donor.name,
      email:   donor.email,
      phone:   donor.phone,
      address: donor.address,
      pan:     donor.pan,
      comment: donor.comment || '',
    }),
  };
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { amount, donor } = JSON.parse(event.body || '{}');

    // Validate required env vars
    const rzpKeyId = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzpKeyId || !rzpKeySecret) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server config error: missing Razorpay keys.' }) };
    }

    // Donor field validation
    const { name, email, phone, address, pan } = donor || {};
    if (!name || !email || !phone || !address || !pan) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'All donor fields (name, email, phone, address, PAN) are required.' }) };
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid PAN format (e.g. ABCDE1234F).' }) };
    }

    // Amount validation
    const amountRupees = parseInt(amount, 10);
    if (isNaN(amountRupees) || amountRupees < ONE_TIME_MIN_AMOUNT) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Minimum donation amount is ₹${ONE_TIME_MIN_AMOUNT}.` }) };
    }

    // Create Razorpay order
    const razorpay = new Razorpay({
      key_id:     rzpKeyId,
      key_secret: rzpKeySecret,
    });

    const order = await razorpay.orders.create({
      amount:   amountRupees * 100,  // paise
      currency: 'INR',
      receipt:  `vazhai_${Date.now()}`,
      notes:    buildNotes({ ...donor, pan: pan.toUpperCase() }),
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ orderId: order.id, amount: order.amount, currency: order.currency }),
    };
  } catch (err) {
    console.error('[/donate/order]', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Could not create payment order. Please try again.' }) };
  }
};