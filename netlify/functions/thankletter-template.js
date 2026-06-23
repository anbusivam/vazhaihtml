// Netlify Function: GET/POST /razorpay/thankletter-template
// Admin only: Retrieve or update the thank-you letter HTML template stored in Netlify Blobs.
// On first deployment, it reads the default template from the static file and seeds the blob.
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/**
 * Get the default template as a fallback (from the static ThankLetterTemplate.html at project root).
 * In production, the file may not be accessible from the function runtime directory,
 * so this is used only for seeding the blob store on first access.
 */
function getDefaultTemplate() {
  const fs = require('fs');
  const path = require('path');
  const templatePath = path.resolve(__dirname, '..', '..', 'ThankLetterTemplate.html');
  try {
    return fs.readFileSync(templatePath, 'utf8');
  } catch (_) {
    // If file not readable (production), return a minimal default
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Thank You from Vazhai</title></head>
<body style="font-family: Arial, sans-serif; padding: 20px; background: #f4f6f8;">
<table width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<div style="max-width:680px;background:#fff;border-radius:12px;padding:40px;">
<h1 style="color:#1a202c;">Thank You for Your Donation</h1>
<p style="font-size:16px;color:#4a5568;">Dear [donor-name],</p>
<p style="font-size:15px;line-height:1.6;color:#4a5568;">
  Thank you for your generous contribution of <strong>[donation-amount]</strong> on <strong>[donation-date]</strong> to Vazhai.
</p>
<p style="font-size:15px;color:#4a5568;">Warm regards,<br><strong>Vazhai Team</strong></p>
<p style="font-size:13px;color:#718096;">Logged in as: [donor-mail-id]</p>
</div></td></tr></table>
</body>
</html>`;
  }
}

/**
 * Get the thank letter template from Netlify Blobs.
 * Falls back to the default file-based template if not yet stored.
 */
async function getTemplate(store) {
  const stored = await store.get('thankletter_template', { type: 'text' });
  if (stored) return stored;
  
  // Seed from the default file
  const defaultTemplate = getDefaultTemplate();
  await store.set('thankletter_template', defaultTemplate);
  return defaultTemplate;
}

exports.handler = async function (event, context) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
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

    // ── GET: Return the current template ──
    if (event.httpMethod === 'GET') {
      const template = await getTemplate(store);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ template }),
      };
    }

    // ── POST: Update the template ──
    if (event.httpMethod === 'POST') {
      const { template } = JSON.parse(event.body || '{}');
      if (!template || typeof template !== 'string') {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'template (string) is required in the request body.' }),
        };
      }

      // Validate template contains required placeholders
      const requiredPlaceholders = ['[donor-name]', '[donation-amount]', '[donation-date]', '[donor-mail-id]'];
      const missing = requiredPlaceholders.filter(p => !template.includes(p));
      if (missing.length > 0) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: 'Template is missing required placeholders: ' + missing.join(', '),
            missing,
          }),
        };
      }

      await store.set('thankletter_template', template);
      console.log('[thankletter-template] Template updated by', session.email);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: 'saved', message: 'Thank letter template updated successfully.' }),
      };
    }

    // Unsupported method
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('[/razorpay/thankletter-template] Error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};