'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const path       = require('path');
const Razorpay   = require('razorpay');

/* ─────────────────────────────────────────
   ENV VALIDATION
───────────────────────────────────────── */
const REQUIRED_ENV = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'TURNSTILE_SECRET_KEY',
  'TURNSTILE_SITE_KEY',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT             = parseInt(process.env.PORT || '3000', 10);
const RZP_KEY_ID       = process.env.RAZORPAY_KEY_ID;
const RZP_KEY_SECRET   = process.env.RAZORPAY_KEY_SECRET;
const TS_SECRET        = process.env.TURNSTILE_SECRET_KEY;
const TS_SITE_KEY      = process.env.TURNSTILE_SITE_KEY;
const ALLOWED_ORIGINS  = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];                                   // empty = allow all

/* ─────────────────────────────────────────
   SUBSCRIPTION PLAN MAP
   (plan_id → amount in paise, label)
───────────────────────────────────────── */
const SUBSCRIPTION_PLANS = {
  'plan_SryRYvzzsWua9X': { amount: 50000,   label: '₹500/mo — 1 school day a month'            },
  'plan_SryRzZlBJN0Sq0': { amount: 100000,  label: '₹1,000/mo — 2 school days a month'         },
  'plan_SrySwUxz4kNykw': { amount: 200000,  label: '₹2,000/mo — 4 school days a month'         },
  'plan_SryU3Nys3VUDQX': { amount: 500000,  label: '₹5,000/mo — 10 school days (partial sponsor)' },
  'plan_SryURl0Iu04xnO': { amount: 1500000, label: '₹15,000/mo — full month, one Companion'    },
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

const SUBSCRIPTION_TOTAL_COUNT = 100;   // recurrence count
const ONE_TIME_MIN_AMOUNT      = 500;   // ₹500 minimum (in rupees)

/* ─────────────────────────────────────────
   RAZORPAY CLIENT
───────────────────────────────────────── */
const razorpay = new Razorpay({
  key_id:     RZP_KEY_ID,
  key_secret: RZP_KEY_SECRET,
});

/* ─────────────────────────────────────────
   EXPRESS APP
───────────────────────────────────────── */
const app = express();

/* ── CORS ── */
const corsOptions = {
  origin: ALLOWED_ORIGINS.length === 0
    ? '*'                                           // dev fallback
    : function (origin, cb) {
        // allow server-to-server / curl (no origin header) only in dev
        if (!origin) return cb(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin '${origin}' not allowed`));
      },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
};
app.use(cors(corsOptions));
app.use(express.json());

/* ── Static files (serves index.html, thankyou.html, images/, etc.) ── */
app.use(express.static(__dirname));

/* ─────────────────────────────────────────
   HELPER — verify Cloudflare Turnstile token
───────────────────────────────────────── */
async function verifyTurnstile(token, remoteip) {
  const body = new URLSearchParams({
    secret:   TS_SECRET,
    response: token,
    ...(remoteip ? { remoteip } : {}),
  });
  const res  = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  const data = await res.json();
  return data.success === true;
}

/* ─────────────────────────────────────────
   HELPER — build donor notes object
   (stored in Razorpay notes as JSON string)
───────────────────────────────────────── */
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

/* ─────────────────────────────────────────
   ROUTE: GET /config
   Returns public keys needed by the client
───────────────────────────────────────── */
app.get('/config', (_req, res) => {
  res.json({
    razorpayKeyId:  RZP_KEY_ID,
    turnstileSiteKey: TS_SITE_KEY,
  });
});

/* ─────────────────────────────────────────
   ROUTE: POST /donate/order
   Creates a Razorpay Order for one-time payment
   Body: { amount, donor, turnstileToken }
───────────────────────────────────────── */
app.post('/donate/order', async (req, res) => {
  try {
    const { amount, donor, turnstileToken } = req.body;

    /* ── Turnstile check ── */
    const humanVerified = await verifyTurnstile(
      turnstileToken,
      req.headers['cf-connecting-ip'] || req.ip,
    );
    if (!humanVerified) {
      return res.status(403).json({ error: 'Turnstile verification failed. Please try again.' });
    }

    /* ── Donor field validation ── */
    const { name, email, phone, address, pan } = donor || {};
    if (!name || !email || !phone || !address || !pan) {
      return res.status(400).json({ error: 'All donor fields (name, email, phone, address, PAN) are required.' });
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid PAN format (e.g. ABCDE1234F).' });
    }

    /* ── Amount validation ── */
    const amountRupees = parseInt(amount, 10);
    if (isNaN(amountRupees) || amountRupees < ONE_TIME_MIN_AMOUNT) {
      return res.status(400).json({ error: `Minimum donation amount is ₹${ONE_TIME_MIN_AMOUNT}.` });
    }

    /* ── Create Razorpay order ── */
    const order = await razorpay.orders.create({
      amount:   amountRupees * 100,         // paise
      currency: 'INR',
      receipt:  `vazhai_${Date.now()}`,
      notes:    buildNotes({ ...donor, pan: pan.toUpperCase() }),
    });

    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('[/donate/order]', err);
    res.status(500).json({ error: 'Could not create payment order. Please try again.' });
  }
});

/* ─────────────────────────────────────────
   ROUTE: POST /donate/verify
   Verifies Razorpay payment signature (one-time)
   Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
───────────────────────────────────────── */
app.post('/donate/verify', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields.' });
    }

    const expected = crypto
      .createHmac('sha256', RZP_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment signature mismatch. Payment could not be verified.' });
    }

    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (err) {
    console.error('[/donate/verify]', err);
    res.status(500).json({ error: 'Verification failed. Please contact us with your payment ID.' });
  }
});

/* ─────────────────────────────────────────
   ROUTE: POST /donate/subscribe
   Creates a Razorpay Subscription for monthly giving
   Body: { planId, donor, turnstileToken }
───────────────────────────────────────── */
app.post('/donate/subscribe', async (req, res) => {
  try {
    const { planId, amount: customAmount, donor, turnstileToken } = req.body;

    /* ── Turnstile check ── */
    const humanVerified = await verifyTurnstile(
      turnstileToken,
      req.headers['cf-connecting-ip'] || req.ip,
    );
    if (!humanVerified) {
      return res.status(403).json({ error: 'Turnstile verification failed. Please try again.' });
    }

    /* ── Donor field validation ── */
    const { name, email, phone, address, pan } = donor || {};
    if (!name || !email || !phone || !address || !pan) {
      return res.status(400).json({ error: 'All donor fields (name, email, phone, address, PAN) are required.' });
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid PAN format (e.g. ABCDE1234F).' });
    }

    /* ── Resolve plan ID (preset or create-on-the-fly for any amount) ── */
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    let resolvedPlanId = planId ? resolvePlanId(planId, host) : planId;
    let resolvedLabel  = '';

    if (planId) {
      /* ── Preset plan ── */
      if (!SUBSCRIPTION_PLANS[planId]) {
        return res.status(400).json({ error: 'Invalid subscription plan.' });
      }
      resolvedLabel = SUBSCRIPTION_PLANS[planId].label;
    } else if (customAmount) {
      /* ── Custom amount — find existing plan or create one ── */
      const amountRupees = parseInt(customAmount, 10);
      if (isNaN(amountRupees) || amountRupees < 500) {
        return res.status(400).json({ error: 'Minimum monthly donation is ₹500.' });
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
      return res.status(400).json({ error: 'Either planId or amount is required.' });
    }

    /* ── Create Razorpay subscription ── */
    const subscription = await razorpay.subscriptions.create({
      plan_id:        resolvedPlanId,
      total_count:    SUBSCRIPTION_TOTAL_COUNT,
      quantity:       1,
      customer_notify: 1,
      notes:          buildNotes({ ...donor, pan: pan.toUpperCase() }),
    });

    res.json({
      subscriptionId: subscription.id,
      planLabel:      resolvedLabel,
    });
  } catch (err) {
    console.error('[/donate/subscribe]', err);
    res.status(500).json({ error: 'Could not create subscription. Please try again.' });
  }
});

/* ─────────────────────────────────────────
   ROUTE: POST /donate/verify-subscription
   Verifies Razorpay subscription payment signature
   Body: { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
───────────────────────────────────────── */
app.post('/donate/verify-subscription', (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing subscription verification fields.' });
    }

    const expected = crypto
      .createHmac('sha256', RZP_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Subscription signature mismatch. Could not be verified.' });
    }

    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (err) {
    console.error('[/donate/verify-subscription]', err);
    res.status(500).json({ error: 'Verification failed. Please contact us with your payment ID.' });
  }
});

/* ─────────────────────────────────────────
   CATCH-ALL — serve index.html for any
   unmatched GET (SPA-style)
───────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ─────────────────────────────────────────
   START
───────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`[vazhai] Server running on http://localhost:${PORT}`);
  console.log(`[vazhai] CORS allowed origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'ALL (dev mode)'}`);
});
