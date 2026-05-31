// Netlify Function: POST /donate/subscribe
// Creates a Razorpay Subscription for monthly giving
const Razorpay = require('razorpay');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SUBSCRIPTION_PLANS = {
  'plan_SryRYvzzsWua9X': { amount: 50000,   label: '₹500/mo — 1 school day a month' },
  'plan_SryRzZlBJN0Sq0': { amount: 100000,  label: '₹1,000/mo — 2 school days a month' },
  'plan_SrySwUxz4kNykw': { amount: 200000,  label: '₹2,000/mo — 4 school days a month' },
  'plan_SryU3Nys3VUDQX': { amount: 500000,  label: '₹5,000/mo — 10 school days (partial sponsor)' },
  'plan_SryURl0Iu04xnO': { amount: 1500000, label: '₹15,000/mo — full month, one Companion' },
};

/* ── Production plan ID overrides (test → production) ── */
const PRODUCTION_PLAN_MAP = {
  'plan_SryRYvzzsWua9X': 'plan_R2TidaR2HFINZH',   // ₹500
  'plan_SryRzZlBJN0Sq0': 'plan_QwpGwGKRqYBJbN',   // ₹1,000
  'plan_SrySwUxz4kNykw': 'plan_QwpHC8ONCOD7iu',   // ₹2,000
  'plan_SryU3Nys3VUDQX': 'plan_QwpHY3yHqaR6bn',   // ₹5,000
  'plan_SryURl0Iu04xnO': 'plan_SryLDwsKq24a58',    // ₹15,000
};

/* ── Determine whether to use production plan IDs ── */
function isProductionHost(host) {
  if (!host) return false;
  const h = host.split(':')[0].toLowerCase();           // strip port
  return h === 'vazhai.in' || h === 'vazhaihtml.netlify.app';
}

/* ── Resolve plan ID for the current host ── */
function resolvePlanId(planId, host) {
  if (isProductionHost(host) && PRODUCTION_PLAN_MAP[planId]) {
    return PRODUCTION_PLAN_MAP[planId];
  }
  return planId;
}

const SUBSCRIPTION_TOTAL_COUNT = 100;

// Cloudflare Turnstile verification
async function verifyTurnstile(token, remoteip) {
  const body = new URLSearchParams({
    secret:   process.env.TURNSTILE_SECRET_KEY || '',
    response: token,
    ...(remoteip ? { remoteip } : {}),
  });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  const data = await res.json();
  return data.success === true;
}

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
    const { planId, amount: customAmount, donor, turnstileToken } = JSON.parse(event.body || '{}');

    // Validate required env vars
    const rzpKeyId = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzpKeyId || !rzpKeySecret) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server config error: missing Razorpay keys.' }) };
    }

    // Turnstile check
    const humanVerified = await verifyTurnstile(
      turnstileToken,
      event.headers['client-ip'] || event.headers['x-forwarded-for'] || '',
    );
    if (!humanVerified) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Turnstile verification failed. Please try again.' }) };
    }

    // Donor field validation
    const { name, email, phone, address, pan } = donor || {};
    if (!name || !email || !phone || !address || !pan) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'All donor fields (name, email, phone, address, PAN) are required.' }) };
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid PAN format (e.g. ABCDE1234F).' }) };
    }

    // Resolve plan ID (preset or create-on-the-fly for any amount)
    const host = event.headers['x-forwarded-host'] || event.headers.host;
    let resolvedPlanId = planId ? resolvePlanId(planId, host) : planId;
    let resolvedLabel  = '';

    const razorpay = new Razorpay({
      key_id:     rzpKeyId,
      key_secret: rzpKeySecret,
    });

    if (planId) {
      // Preset plan
      if (!SUBSCRIPTION_PLANS[planId]) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid subscription plan.' }) };
      }
      resolvedLabel = SUBSCRIPTION_PLANS[planId].label;
    } else if (customAmount) {
      // Custom amount — find existing plan or reuse one
      const amountRupees = parseInt(customAmount, 10);
      if (isNaN(amountRupees) || amountRupees < 500) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Minimum monthly donation is ₹500.' }) };
      }
      const amountPaise = amountRupees * 100;

      // Check if any existing preset plan matches this amount
      const match = Object.entries(SUBSCRIPTION_PLANS).find(([_, p]) => p.amount === amountPaise);
      if (match) {
        resolvedPlanId = match[0];
        resolvedLabel  = match[1].label;
      } else {
        // Fetch existing plans from Razorpay to find one with matching amount
        let existingPlanId = null;
        let existingPlanLabel = null;

        try {
          const plansResp = await razorpay.plans.all({ count: 100 });
          console.log("plans fetched:",plansResp.count);
          const plansList = plansResp.items || [];
          const found = plansList.find(p => {
            if (!p.item) return false;
            const itemAmt = typeof p.item.amount === 'string' ? parseInt(p.item.amount, 10) : p.item.amount;
            return itemAmt === amountPaise && p.item.currency === 'INR';
          });
          if (found) {
            existingPlanId = found.id;
            existingPlanLabel = found.item.name ||
              `₹${amountRupees.toLocaleString('en-IN')}/mo — custom monthly gift`;
          }
        } catch (fetchErr) {
          // Fall through — create new plan on error
        }

        if (existingPlanId) {
          resolvedPlanId = existingPlanId;
          resolvedLabel  = existingPlanLabel;
        } else {
          // Create a new plan on the fly via Razorpay API
          const newPlan = await razorpay.plans.create({
            period:   'monthly',
            interval: 1,
            item: {
              name:        `Vazhai Monthly ₹${amountRupees}`,
              amount:      amountPaise,
              currency:    'INR',
              description: `Monthly donation of ₹${amountRupees} to support rural education in Tamil Nadu`,
            },
            notes: {
              source: 'vazhai-custom-monthly',
            },
          });
          resolvedPlanId = newPlan.id;
          resolvedLabel  = `₹${amountRupees.toLocaleString('en-IN')}/mo — custom monthly gift`;
        }
      }
    } else {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Either planId or amount is required.' }) };
    }

    // Strip non-digit characters from phone so Razorpay accepts it
    const cleanPhone = donor.phone.replace(/[^\d+]/g, '');

    // Create Razorpay subscription — pass customer_details so the
    // checkout modal pre-fills the phone number (subscription checkouts
    // do not respect the frontend `prefill` object the way one-time
    // checkouts do; customer_details must be set on the subscription itself).
    const subscription = await razorpay.subscriptions.create({
      plan_id:         resolvedPlanId,
      total_count:     SUBSCRIPTION_TOTAL_COUNT,
      quantity:        1,
      customer_notify: 1,
      customer_details: {
        name:    donor.name,
        email:   donor.email,
        contact: cleanPhone,
      },
      notes: buildNotes({ ...donor, pan: pan.toUpperCase() }),
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        subscriptionId: subscription.id,
        planLabel:      resolvedLabel,
      }),
    };
  } catch (err) {
    console.error('[/donate/subscribe]', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Could not create subscription. Please try again.' }) };
  }
};
