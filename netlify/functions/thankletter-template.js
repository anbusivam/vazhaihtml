// Netlify Function: GET/POST /razorpay/thankletter-template
// Admin only: Manage thank-you letter HTML templates stored in Netlify Blobs.
// The legacy "Thank You Letter" (id: thank_letter_legacy) is the one used for
// sending emails (stored at `thankletter_template` blob key). Additional
// templates can be created for future use in other contexts.
// Each template has a `deletable` flag. The legacy letter is non-deletable.
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
 * Standard base HTML template for new templates.
 */
function getBaseTemplate() {
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

const LIST_KEY = 'thankletter_template:list';
const LEGACY_ID = 'thank_letter_legacy';
const KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_\-]{1,50}$/;

/**
 * Convert a template name to a machine-friendly key (slug).
 */
function nameToKey(name) {
  return name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

/**
 * Get the list of template metadata from the blob store.
 * Returns an array of {id, name, deletable, createdAt, updatedAt}.
 */
async function getTemplateList(store) {
  const raw = await store.get(LIST_KEY, { type: 'text' });
  let list = [];
  if (raw) {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }

  // If the legacy blob exists but is not in the list, migrate it
  const legacyContent = await store.get('thankletter_template', { type: 'text' });
  if (legacyContent && !list.find(t => t.id === LEGACY_ID)) {
    const now = new Date().toISOString();
    await store.set(`thankletter_template:${LEGACY_ID}`, legacyContent);
    list.unshift({
      id: LEGACY_ID,
      name: 'Thank You Letter',
      deletable: false,
      createdAt: now,
      updatedAt: now,
    });
    await saveTemplateList(store, list);
  }

  return list;
}

/**
 * Save the template list to the blob store.
 */
async function saveTemplateList(store, list) {
  await store.set(LIST_KEY, JSON.stringify(list));
}

/**
 * Get the list of all supported placeholders (for reference, no required flag).
 */
function getSupportedPlaceholders() {
  return [
    { key: '[donor-name]', desc: "Donor's name (from payment)" },
    { key: '[user-name]', desc: "User's saved name (from profile)" },
    { key: '[user-tamilname]', desc: "User's saved Tamil name (from profile)" },
    { key: '[donation-amount]', desc: 'Donation amount (e.g. ₹1,000.00)' },
    { key: '[donation-date]', desc: 'Date of donation' },
    { key: '[donor-mail-id]', desc: "Donor's email address" },
  ];
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

    const method = event.httpMethod;
    // Netlify Functions provide queryStringParameters directly
    const queryParams = new URLSearchParams(event.queryStringParameters || {});

    // ── GET ──
    if (method === 'GET') {
      // GET ?placeholders=true → return supported placeholders list
      if (queryParams.get('placeholders') === 'true') {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ placeholders: getSupportedPlaceholders() }),
        };
      }

      // GET ?list=true → return template list
      if (queryParams.get('list') === 'true') {
        const list = await getTemplateList(store);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ templates: list }),
        };
      }

      // GET ?id=xxx → return specific template
      const id = queryParams.get('id');
      if (id) {
        const template = await store.get(`thankletter_template:${id}`, { type: 'text' });
        if (!template) {
          return {
            statusCode: 404,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Template not found.' }),
          };
        }
        const list = await getTemplateList(store);
        const meta = list.find(t => t.id === id) || { id, name: 'Unknown', deletable: true };
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            template,
            name: meta.name,
            id: meta.id,
            deletable: meta.deletable,
          }),
        };
      }

      // GET (no params) → return the thank letter (backward compatible)
      const thankLetter = await store.get('thankletter_template', { type: 'text' });
      if (thankLetter) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ template: thankLetter, name: 'Thank You Letter', id: LEGACY_ID }),
        };
      }

      // No template exists yet → return base template
      const baseTemplate = getBaseTemplate();
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ template: baseTemplate, name: 'Thank You Letter', id: LEGACY_ID }),
      };
    }

    // ── POST ──
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      // ── Create new template ──
      if (action === 'create') {
        const { name, template, key } = body;
        if (!name || !name.trim()) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Template name is required.' }),
          };
        }
        if (!template || typeof template !== 'string') {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'template (HTML string) is required.' }),
          };
        }

        // Determine the template ID: use provided key, or auto-derive from name
        let id;
        if (key && key.trim()) {
          id = key.trim();
          if (!KEY_REGEX.test(id)) {
            return {
              statusCode: 400,
              headers: CORS_HEADERS,
              body: JSON.stringify({ error: 'Invalid key. Must start with a letter and contain only letters, numbers, hyphens, and underscores (2-50 chars).' }),
            };
          }
        } else {
          id = nameToKey(name);
          if (!id || id.length < 2) {
            return {
              statusCode: 400,
              headers: CORS_HEADERS,
              body: JSON.stringify({ error: 'Could not derive a valid key from the name. Please provide a key explicitly.' }),
            };
          }
        }

        // Check for duplicate key
        const list = await getTemplateList(store);
        if (list.find(t => t.id === id)) {
          return {
            statusCode: 409,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: `A template with key "${id}" already exists.` }),
          };
        }

        const now = new Date().toISOString();

        // Store the template content
        await store.set(`thankletter_template:${id}`, template);

        // Add to the list
        list.push({ id, name: name.trim(), deletable: true, createdAt: now, updatedAt: now });
        await saveTemplateList(store, list);

        console.log('[thankletter-template] Template created:', id, 'by', session.email);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: 'created',
            id,
            name: name.trim(),
            deletable: true,
            message: `Template "${name.trim()}" created with key "${id}".`,
          }),
        };
      }

      // ── Update existing template ──
      if (action === 'update') {
        const { id, name, template } = body;
        if (!id) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Template id is required.' }),
          };
        }

        // Verify template exists
        const existingContent = await store.get(`thankletter_template:${id}`, { type: 'text' });
        if (!existingContent) {
          return {
            statusCode: 404,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Template not found.' }),
          };
        }

        const list = await getTemplateList(store);
        const metaIndex = list.findIndex(t => t.id === id);
        if (metaIndex === -1) {
          return {
            statusCode: 404,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Template metadata not found.' }),
          };
        }

        const now = new Date().toISOString();

        if (template !== undefined) {
          if (typeof template !== 'string') {
            return {
              statusCode: 400,
              headers: CORS_HEADERS,
              body: JSON.stringify({ error: 'template must be a string.' }),
            };
          }
          await store.set(`thankletter_template:${id}`, template);
          list[metaIndex].updatedAt = now;

          // If this is the legacy Thank You Letter, also update the backward-compatible key
          if (id === LEGACY_ID) {
            await store.set('thankletter_template', template);
          }
        }

        if (name && name.trim()) {
          list[metaIndex].name = name.trim();
          list[metaIndex].updatedAt = now;
        }

        await saveTemplateList(store, list);

        console.log('[thankletter-template] Template updated:', id, 'by', session.email);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: 'updated',
            id,
            name: list[metaIndex].name,
            deletable: list[metaIndex].deletable,
            message: `Template "${list[metaIndex].name}" updated successfully.`,
          }),
        };
      }

      // ── Delete template ──
      if (action === 'delete') {
        const { id } = body;
        if (!id) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Template id is required.' }),
          };
        }

        const list = await getTemplateList(store);
        const metaIndex = list.findIndex(t => t.id === id);
        if (metaIndex === -1) {
          return {
            statusCode: 404,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Template not found.' }),
          };
        }

        // Check if template is deletable
        if (list[metaIndex].deletable === false) {
          return {
            statusCode: 403,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'This template is protected and cannot be deleted.' }),
          };
        }

        // Delete the template content
        await store.delete(`thankletter_template:${id}`);

        // Remove from list
        list.splice(metaIndex, 1);
        await saveTemplateList(store, list);

        console.log('[thankletter-template] Template deleted:', id, 'by', session.email);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: 'deleted',
            message: 'Template deleted successfully.',
          }),
        };
      }

      // ── Legacy: Direct save template (backward compat) ──
      // When body has {template: "..."} without action, update the thank letter content
      if (body.template && typeof body.template === 'string' && !action) {
        const { template } = body;

        // Update the legacy Thank You Letter's managed content
        const list = await getTemplateList(store);
        const legacyMeta = list.find(t => t.id === LEGACY_ID);
        if (legacyMeta) {
          await store.set(`thankletter_template:${LEGACY_ID}`, template);
          legacyMeta.updatedAt = new Date().toISOString();
          await saveTemplateList(store, list);
        }

        // Always update the backward-compatible key
        await store.set('thankletter_template', template);

        console.log('[thankletter-template] Template updated (legacy) by', session.email);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: 'saved',
            message: 'Thank letter template updated successfully.',
          }),
        };
      }

      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Invalid request. Provide action (create/update/delete) or template content.' }),
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