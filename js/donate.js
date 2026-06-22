/* ═══════════════════════════════════════════════════
   DONATION FLOW — used on donate.html and thankyou.html
═══════════════════════════════════════════════════ */

/* State */
let donState = {
  type:      null,     // 'onetime' | 'monthly'
  amount:    null,     // rupees (onetime only)
  planId:    null,     // plan_xxx (monthly only)
  planLabel: null,
};

let rzpKeyId = null;

/* Load config from server on init */
async function loadDonConfig() {
  try {
    let res = await fetch('/.netlify/functions/config');
    if (!res.ok || (res.headers && !(res.headers.get && (res.headers.get('content-type') || '').includes('application/json')))) {
      try {
        res = await fetch('/.netlify/functions/config-cors');
      } catch (err) {}
    }
    if (!res.ok || (res.headers && !(res.headers.get && (res.headers.get('content-type') || '').includes('application/json')))) {
      try {
        const alt = `${location.protocol}//localhost:9999/.netlify/functions/config`;
        res = await fetch(alt);
      } catch (err) {}
    }
    const data = await res.json();
    rzpKeyId         = data.razorpayKeyId;
  } catch (e) {
    console.error('[donation] Could not load config:', e);
  }
}
loadDonConfig();

/* ── Mode tab switch ── */
function switchDonMode(mode) {
  document.getElementById('tab-onetime').classList.toggle('active', mode === 'onetime');
  document.getElementById('tab-monthly').classList.toggle('active', mode === 'monthly');
  document.getElementById('don-panel-onetime').style.display = mode === 'onetime' ? '' : 'none';
  document.getElementById('don-panel-monthly').style.display = mode === 'monthly' ? '' : 'none';
}

/* ── Amount tab selection ── */
function selectAmtTab(btn) {
  const isMonthly = btn.dataset.type === 'monthly';
  const tabGroup  = isMonthly ? '#don-monthly-tabs' : '#don-onetime-tabs';
  document.querySelectorAll(tabGroup + ' .don-amt-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const isAny = btn.dataset.amount === '0' || (isMonthly && btn.dataset.plan === '');
  const anyWrap = document.getElementById(isMonthly ? 'don-monthly-any-wrap' : 'don-onetime-any-wrap');
  if (isAny) {
    anyWrap.classList.add('visible');
    setTimeout(() => {
      const inp = document.getElementById(isMonthly ? 'don-monthly-any-input' : 'don-onetime-any-input');
      if (inp) inp.focus();
    }, 100);
  } else {
    anyWrap.classList.remove('visible');
  }

  const descEl = document.getElementById(isMonthly ? 'don-monthly-desc-text' : 'don-onetime-desc-text');
  if (descEl) descEl.textContent = btn.dataset.desc || '';
}

/* ── Proceed buttons ── */
function proceedOnetime() {
  const activeTab = document.querySelector('#don-onetime-tabs .don-amt-tab.active');
  if (!activeTab) return;
  const isAny = activeTab.dataset.amount === '0';
  if (isAny) {
    const val = parseInt(document.getElementById('don-onetime-any-input').value, 10);
    if (!val || val < 500) {
      alert('Please enter a one-time amount of at least ₹500.');
      document.getElementById('don-onetime-any-input').focus();
      return;
    }
    donState.type = 'onetime'; donState.amount = val; donState.planId = null; donState.planLabel = null;
  } else {
    donState.type = 'onetime'; donState.amount = parseInt(activeTab.dataset.amount, 10); donState.planId = null; donState.planLabel = null;
  }
  showStep2();
}

function proceedMonthly() {
  const activeTab = document.querySelector('#don-monthly-tabs .don-amt-tab.active');
  if (!activeTab) return;
  const isAny = activeTab.dataset.plan === '';
  if (isAny) {
    const val = parseInt(document.getElementById('don-monthly-any-input').value, 10);
    if (!val || val < 500) {
      alert('Please enter a monthly amount of at least ₹500.');
      document.getElementById('don-monthly-any-input').focus();
      return;
    }
    donState.type = 'monthly'; donState.amount = val; donState.planId = null; donState.planLabel = 'Any monthly amount';
  } else {
    donState.type = 'monthly'; donState.amount = null; donState.planId = activeTab.dataset.plan; donState.planLabel = activeTab.dataset.planLabel;
  }
  showStep2();
}

/* Legacy amount selection */
function selectAmount(btn) {
  donState.type      = btn.dataset.type;
  donState.amount    = btn.dataset.amount    ? parseInt(btn.dataset.amount, 10)  : null;
  donState.planId    = btn.dataset.plan      ? btn.dataset.plan                  : null;
  donState.planLabel = btn.dataset.planLabel ? btn.dataset.planLabel             : null;
  showStep2();
}

function toggleCustomAmount(btn) {
  document.querySelectorAll('.don-onetime-grid .don-btn').forEach(b => b.classList.remove('featured'));
  btn.classList.add('featured');
  donState.type = 'onetime'; donState.amount = null; donState.planId = null; donState.planLabel = null;
  showStep2();
}

function toggleMonthlyCustomAmount(btn) {
  document.querySelectorAll('.don-monthly-block .don-btn, .don-monthly-block .don-btn-sm').forEach(b => b.classList.remove('featured'));
  btn.classList.add('featured');
  donState.type = 'monthly'; donState.amount = null; donState.planId = null; donState.planLabel = 'Any monthly amount';
  showStep2();
}

/* ── Show step 2 ── */
function showStep2() {
  document.getElementById('don-step-1').classList.add('don-step-hidden');
  document.getElementById('don-step-2').classList.remove('don-step-hidden');
  clearError();

  const labelEl    = document.getElementById('don-selection-label');
  const amtEl      = document.getElementById('don-selection-amt');
  const customGroup = document.getElementById('don-custom-form-group');

  customGroup.classList.add('don-step-hidden');

  if (donState.type === 'monthly') {
    labelEl.textContent = 'Monthly Gift';
    if (donState.planId) {
      amtEl.textContent = donState.planLabel || '';
    } else {
      amtEl.textContent = donState.amount ? `₹${donState.amount.toLocaleString('en-IN')}/month` : 'Custom monthly amount';
    }
  } else {
    labelEl.textContent = 'One-time Gift';
    amtEl.textContent   = donState.amount ? `₹${donState.amount.toLocaleString('en-IN')}` : 'Custom amount';
  }

  /* ── DEV MODE auto-fill ── */
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    if (!document.getElementById('don-name').value) {
      document.getElementById('don-name').value    = 'Test Donor';
    }
    if (!document.getElementById('don-email').value) {
      document.getElementById('don-email').value   = 'test@example.com';
    }
    if (!document.getElementById('don-phone').value) {
      document.getElementById('don-phone').value   = '+91 98765 43210';
    }
    if (!document.getElementById('don-address').value) {
      document.getElementById('don-address').value = 'Test Address, Chennai, Tamil Nadu 600001';
    }
    if (!document.getElementById('don-pan').value) {
      document.getElementById('don-pan').value     = 'ABCDE1234F';
    }
    if (!document.getElementById('don-comment').value) {
      document.getElementById('don-comment').value = 'Test donation — local dev mode';
    }
  }

  window.scrollTo({ top: document.getElementById('don-step-2').getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
}

/* ── Back to step 1 ── */
function goBackToStep1() {
  document.getElementById('don-step-2').classList.add('don-step-hidden');
  document.getElementById('don-step-1').classList.remove('don-step-hidden');
  clearError();
  document.getElementById('don-custom-form-input').value = '';
}

/* ── Validation ── */
function collectDonor() {
  return {
    name:    document.getElementById('don-name').value.trim(),
    email:   document.getElementById('don-email').value.trim(),
    phone:   document.getElementById('don-phone').value.trim(),
    address: document.getElementById('don-address').value.trim(),
    pan:     document.getElementById('don-pan').value.trim().toUpperCase(),
    comment: document.getElementById('don-comment').value.trim(),
  };
}

function validateDonor(donor) {
  if (!donor.name)    return 'Please enter your full name.';
  if (!donor.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donor.email))
                      return 'Please enter a valid email address.';
  if (!donor.phone || !/^\+?[0-9\s\-()]{7,15}$/.test(donor.phone))
                      return 'Please enter a valid phone number.';
  if (!donor.address) return 'Please enter your mailing address.';
  if (!donor.pan)     return 'Please enter your PAN number.';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(donor.pan))
                      return 'PAN format is invalid. Expected format: ABCDE1234F.';
  return null;
}

/* ── Submit ── */
async function submitDonation() {
  clearError();

  if (!rzpKeyId) {
    showError('Payment system is not ready. Please refresh and try again.');
    return;
  }

  if (donState.type === 'onetime' && donState.amount === null) {
    const raw = parseInt(document.getElementById('don-custom-form-input').value, 10);
    if (!raw || raw < 500) {
      showError('Please enter a donation amount of at least ₹500.');
      document.getElementById('don-custom-form-input').focus();
      return;
    }
    donState.amount = raw;
  }

  const donor = collectDonor();
  const validationError = validateDonor(donor);
  if (validationError) {
    showError(validationError);
    return;
  }

  setLoading(true);
  if (donState.type === 'onetime') {
    await handleOnetime(donor);
  } else {
    await handleMonthly(donor);
  }
}

/* Helper - API URL routing */
const _netlifyFunctionsLocalPort = 8888;
const _isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const _functionMap = {
  '/donate/order': 'donate-order',
  '/donate/verify': 'donate-verify',
  '/donate/subscribe': 'donate-subscribe',
  '/donate/verify-subscription': 'donate-verify-subscription',
};
function apiUrl(path) {
  if (_isLocalHost && _functionMap[path]) {
    return `http://localhost:${_netlifyFunctionsLocalPort}/.netlify/functions/${_functionMap[path]}`;
  }
  return path;
}

/* ── One-time flow ── */
async function handleOnetime(donor) {
  try {
    const res  = await fetch(apiUrl('/donate/order'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: donState.amount, donor }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Could not create payment. Please try again.'); setLoading(false); return; }

    const rzp = new Razorpay({
      key: rzpKeyId, order_id: data.orderId, amount: data.amount, currency: data.currency,
      name: 'Vazhai NGO', description: 'One-time donation — Rural Education, Tamil Nadu',
      image: '/images/favicon_io/logo192x192.png',
      prefill: { name: donor.name, email: donor.email, contact: donor.phone },
      theme: { color: '#f5c842' },
      // Pass donor details as notes so they appear on the payment record for sync
      notes: {
        donor: JSON.stringify({
          name: donor.name,
          email: donor.email,
          phone: donor.phone,
          address: donor.address,
          pan: donor.pan,
          comment: donor.comment || '',
        }),
      },
      handler: async function(response) {
        const vres  = await fetch(apiUrl('/donate/verify'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(response),
        });
        const vdata = await vres.json();
        if (vres.ok && vdata.success) {
          window.location.href = 'thankyou.html?type=onetime&pid=' + vdata.paymentId + '&name=' + encodeURIComponent(donor.name) + '&amount=' + donState.amount;
        } else {
          showError(vdata.error || 'Payment received but verification failed. Contact us with payment ID: ' + (response.razorpay_payment_id || ''));
          setLoading(false);
        }
      },
      modal: { ondismiss: function() { setLoading(false); } },
    });
    rzp.open();
  } catch (err) {
    console.error('[onetime]', err);
    showError('Something went wrong. Please try again.');
    setLoading(false);
  }
}

/* ── Monthly flow ── */
async function handleMonthly(donor) {
  try {
    let monthlyAmount = donState.amount;
    if (!donState.planId && (!monthlyAmount || monthlyAmount < 500)) {
      showError('Please go back and enter a valid monthly amount of at least ₹500.');
      setLoading(false);
      return;
    }

    const body = { donor };
    if (donState.planId) {
      body.planId = donState.planId;
    } else {
      body.amount = monthlyAmount;
    }

    const res  = await fetch(apiUrl('/donate/subscribe'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Could not create subscription.'); setLoading(false); return; }

    const rzp = new Razorpay({
      key: rzpKeyId, subscription_id: data.subscriptionId,
      name: 'Vazhai NGO', description: data.planLabel,
      image: '/images/favicon_io/logo192x192.png',
      prefill: { name: donor.name, email: donor.email, contact: donor.phone },
      theme: { color: '#f5c842' },
      // Pass donor details as notes so they appear on the first payment record for sync
      notes: {
        donor: JSON.stringify({
          name: donor.name,
          email: donor.email,
          phone: donor.phone,
          address: donor.address,
          pan: donor.pan,
          comment: donor.comment || '',
        }),
      },
      handler: async function(response) {
        const vres  = await fetch(apiUrl('/donate/verify-subscription'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(response),
        });
        const vdata = await vres.json();
        if (vres.ok && vdata.success) {
          window.location.href = 'thankyou.html?type=monthly&pid=' + vdata.paymentId + '&name=' + encodeURIComponent(donor.name) + '&plan=' + encodeURIComponent(data.planLabel || '');
        } else {
          showError(vdata.error || 'Subscription created but first payment verification failed.');
          setLoading(false);
        }
      },
      modal: { ondismiss: function() { setLoading(false); } },
    });
    rzp.open();
  } catch (err) {
    console.error('[monthly]', err);
    showError('Something went wrong. Please try again.');
    setLoading(false);
  }
}

/* ── UI helpers ── */
function showError(msg) {
  const el = document.getElementById('don-error');
  el.textContent = msg;
  el.classList.add('visible');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearError() {
  const el = document.getElementById('don-error');
  el.textContent = '';
  el.classList.remove('visible');
}
function setLoading(on) {
  const btn     = document.getElementById('don-submit-btn');
  const label   = document.getElementById('don-submit-label');
  const spinner = document.getElementById('don-submit-spinner');
  btn.disabled          = on;
  label.style.display   = on ? 'none'   : '';
  spinner.style.display = on ? 'inline-block' : 'none';
}