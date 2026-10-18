// Public endpoint: POST /volunteer/register
const crypto = require('crypto');
const { getVolunteerStore } = require('./volunteer-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_INTERESTS = new Set([
  'learning-materials',
  'career-conversation',
  'catch-up-support',
  'student-projects',
  'college-guidance',
  'employment-exchange',
  'field-survey',
  'outreach',
  'explore',
]);
const ALLOWED_AGE_GROUPS = new Set(['below-18', '18-24', '25-35', '36-45', '46-50', 'above-50']);
const ALLOWED_AVAILABILITY = new Set(['one-task', 'few-hours-month', 'regular', 'discuss']);

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function response(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendVolunteerNotification(record) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[volunteer-register] RESEND_API_KEY is not configured. Registration email was not sent.');
    return;
  }

  const fields = [
    ['Registration ID', record.id],
    ['Submitted at', record.createdAt],
    ['Name', record.name],
    ['Email', record.email],
    ['Phone', record.phone],
    ['City', record.city],
    ['Age group', record.ageGroup],
    ['Educational qualification', record.qualification],
    ['Interests', record.interests.join(', ')],
    ['Availability', record.availability],
    ['How they heard about Vazhai', record.howHeard],
    ['Comments', record.comments],
    ['Consent', 'Yes'],
  ];
  const text = fields.map(([label, value]) => `${label}: ${value || '(not provided)'}`).join('\n');
  const html = fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value || '(not provided)')}</p>`).join('');

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.VOLUNTEER_NOTIFICATION_FROM || process.env.OTP_FROM_EMAIL || 'do-not-reply@vazhai.in',
      to: [process.env.VOLUNTEER_NOTIFICATION_TO || 'vazhai.connect@gmail.com'],
      reply_to: record.email,
      subject: `New volunteer registration: ${record.id} - ${record.name}`,
      text,
      html: `<h2>New Vazhai volunteer registration</h2>${html}`,
    }),
  });

  if (!resendResponse.ok) {
    const errorText = await resendResponse.text();
    throw new Error(`Resend returned ${resendResponse.status}: ${errorText}`);
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return response(200, {});
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed. Use POST.' });

  try {
    const body = JSON.parse(event.body || '{}');
    if (clean(body.website, 100)) return response(200, { success: true });

    if (body.action === 'whatsapp-detail') {
      const id = clean(body.id, 40);
      const token = clean(body.token, 100);
      const name = clean(body.name, 120);
      const email = clean(body.email, 254).toLowerCase();
      const note = clean(body.note, 1000);
      if (!id || !token || !name || !validEmail(email)) return response(400, { error: 'Please provide your name and a valid email.' });
      const store = await getVolunteerStore(event);
      const record = await store.get(`volunteer:${id}`, { type: 'json' });
      if (!record || record.whatsappToken !== token) return response(403, { error: 'This registration link has expired.' });
      record.whatsappDetails = { name, email, note, submittedAt: new Date().toISOString() };
      record.updatedAt = new Date().toISOString();
      await store.setJSON(`volunteer:${id}`, record);
      return response(200, { success: true });
    }

    const name = clean(body.name, 120);
    const email = clean(body.email, 254).toLowerCase();
    const phone = clean(body.phone, 40);
    const ageGroup = clean(body.ageGroup, 30);
    const qualification = clean(body.qualification, 120);
    const city = clean(body.city, 120);
    const availability = clean(body.availability, 30);
    const howHeard = clean(body.howHeard, 80);
    const comments = clean(body.comments, 2000);
    const interests = Array.isArray(body.interests)
      ? [...new Set(body.interests.map(value => clean(value, 40)).filter(value => ALLOWED_INTERESTS.has(value)))]
      : [];

    if (!name) return response(400, { error: 'Name is required.' });
    if (!validEmail(email)) return response(400, { error: 'A valid email is required.' });
    if (!phone) return response(400, { error: 'Phone number is required.' });
    if (!interests.length) return response(400, { error: 'Please choose at least one way to contribute.' });
    if (body.consent !== true) return response(400, { error: 'Please confirm that Vazhai may store these details and contact you about volunteering.' });
    if (ageGroup && !ALLOWED_AGE_GROUPS.has(ageGroup)) return response(400, { error: 'Please select a valid age group.' });
    if (availability && !ALLOWED_AVAILABILITY.has(availability)) return response(400, { error: 'Please select a valid availability option.' });

    const store = await getVolunteerStore(event);
    const existingIds = await store.get('volunteers:list', { type: 'json' }) || [];
    const year = new Date().getFullYear();
    let number = existingIds.length + 1;
    let id = `VOL-${year}-${String(number).padStart(4, '0')}`;
    while (existingIds.includes(id)) {
      number++;
      id = `VOL-${year}-${String(number).padStart(4, '0')}`;
    }

    const now = new Date().toISOString();
    const whatsappToken = crypto.randomBytes(24).toString('hex');
    const record = {
      id,
      name,
      email,
      phone,
      ageGroup,
      qualification,
      city,
      interests,
      availability,
      howHeard,
      comments,
      whatsappToken,
      status: 'new',
      notes: '',
      createdAt: now,
      updatedAt: now,
    };

    await store.setJSON(`volunteer:${id}`, record);
    await store.setJSON('volunteers:list', [...existingIds, id]);

    try {
      await sendVolunteerNotification(record);
    } catch (emailError) {
      console.error('[volunteer-register] Registration email failed:', emailError.message);
    }

    return response(200, {
      success: true,
      id,
      whatsappToken,
      message: 'Thank you. Your volunteer registration has been received.',
    });
  } catch (err) {
    console.error('[volunteer-register] Error:', err.message, err.stack);
    return response(500, { error: 'Unable to save your registration right now. Please try again.' });
  }
};
