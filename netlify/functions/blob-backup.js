// Netlify Function: GET/POST /razorpay/blob-backup
// System admin only (hardcoded): Export and restore ALL blob data (users, payments, receipts map, thankletter template, blog data).
// 
// GET  /razorpay/blob-backup — Exports all blob data as a downloadable JSON file.
// POST /razorpay/blob-backup — Restores blob data from uploaded JSON payload.
//   Before restoring, the caller MUST first auto-backup existing data (download triggered client-side).
//   This two-step flow prevents accidental restore of wrong backup data.
//
// WARNING: Restoring will OVERWRITE existing blob data. Use with extreme caution.

const { getStore, ADMIN_EMAILS } = require('./auth-store');
const { getBlogStore } = require('./blog-store');

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
 * Export ALL blob data from both auth and blog stores.
 * Returns a complete dump object.
 */
async function exportAllData(event) {
  const authStore = await getStore(event);
  const blogStore = await getBlogStore(event);

  const dump = {
    exportedAt: new Date().toISOString(),
    version: 1,
    stores: {},
  };

  // ── Auth store data ──
  const authData = {};

  // users:list
  const usersList = await authStore.get('users:list', { type: 'json' }) || [];
  authData['users:list'] = usersList;

  // each user:{email}
  const users = {};
  for (const email of usersList) {
    try {
      const userData = await authStore.get(`user:${email}`, { type: 'json' });
      if (userData) {
        users[email] = userData;
      }
    } catch (_) {
      // Skip corrupt records
    }
  }
  authData.users = users;

  // payments:list
  const paymentsList = await authStore.get('payments:list', { type: 'json' }) || [];
  authData['payments:list'] = paymentsList;

  // each payment:{paymentId}
  const payments = {};
  for (const paymentId of paymentsList) {
    try {
      const paymentData = await authStore.get(`payment:${paymentId}`, { type: 'json' });
      if (paymentData) {
        payments[paymentId] = paymentData;
      }
    } catch (_) {
      // Skip corrupt records
    }
  }
  authData.payments = payments;

  // receipts:map
  const receiptsMap = await authStore.get('receipts:map', { type: 'json' }) || {};
  authData['receipts:map'] = receiptsMap;

  // thankletter_template
  const thankletterTemplate = await authStore.get('thankletter_template', { type: 'text' });
  if (thankletterTemplate !== null && thankletterTemplate !== undefined) {
    authData['thankletter_template'] = thankletterTemplate;
  }

  // ── Sessions (list of active session keys - metadata only, not session content) ──
  // We do NOT backup session data for security/privacy reasons. Sessions are short-lived.
  authData['_note'] = 'Sessions are NOT exported for security. Users will need to re-login after restore.';

  dump.stores.auth = authData;

  // ── Blog store data ──
  if (blogStore) {
    const blogData = {};

    // blog:index — the main index containing all blog post metadata
    const blogIndex = await blogStore.get('blog:index', { type: 'json' }) || { posts: [] };
    blogData['blog:index'] = blogIndex;

    // each blog:post:{slug} — full blog post content
    const blogs = {};
    for (const entry of blogIndex.posts) {
      const slug = entry.slug;
      try {
        const blogPost = await blogStore.get(`blog:post:${slug}`, { type: 'json' });
        if (blogPost) {
          blogs[slug] = blogPost;
        }
      } catch (_) {}
    }
    blogData.blogs = blogs;

    // blog:comments:{slug} — comment index per slug
    const commentsBySlug = {};
    for (const entry of blogIndex.posts) {
      const slug = entry.slug;
      try {
        const commentIds = await blogStore.get(`blog:comments:${slug}`, { type: 'json' });
        if (Array.isArray(commentIds) && commentIds.length > 0) {
          commentsBySlug[slug] = commentIds;
        }
      } catch (_) {}
    }
    blogData['comments:by-slug'] = commentsBySlug;

    // each blog:comment:{slug}:{commentId} — individual comments
    const comments = {};
    for (const [slug, commentIds] of Object.entries(commentsBySlug)) {
      for (const commentId of commentIds) {
        try {
          const commentData = await blogStore.get(`blog:comment:${slug}:${commentId}`, { type: 'json' });
          if (commentData) {
            comments[`${slug}:${commentId}`] = commentData;
          }
        } catch (_) {}
      }
    }
    blogData.comments = comments;

    // blog:pending-comments — global pending comments list
    const pendingComments = await blogStore.get('blog:pending-comments', { type: 'json' }) || [];
    blogData['pending-comments'] = pendingComments;

    dump.stores.blog = blogData;
  }

  return dump;
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);

    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // Only hardcoded system admins can access backup/restore
    if (!ADMIN_EMAILS.includes(session.email)) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: only system admins can access this feature.' }) };
    }

    // ── GET: Export all blob data ──
    if (event.httpMethod === 'GET') {
      console.log(`[blob-backup] Export requested by ${session.email}`);

      const dump = await exportAllData(event);

      const jsonStr = JSON.stringify(dump, null, 2);
      const base64 = Buffer.from(jsonStr, 'utf-8').toString('base64');

      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="vazhai-blob-backup-${new Date().toISOString().split('T')[0]}.json"`,
        },
        body: JSON.stringify({
          success: true,
          data: dump,
          base64,
          stats: {
            users: Object.keys(dump.stores.auth.users || {}).length,
            payments: Object.keys(dump.stores.auth.payments || {}).length,
            receipts: Object.keys(dump.stores.auth['receipts:map'] || {}).length,
            hasThankletterTemplate: !!dump.stores.auth['thankletter_template'],
            blogs: dump.stores.blog ? Object.keys(dump.stores.blog.blogs || {}).length : 0,
            comments: dump.stores.blog ? Object.keys(dump.stores.blog.comments || {}).length : 0,
          },
          exportedAt: dump.exportedAt,
        }),
      };
    }

    // ── POST: Restore blob data ──
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { data, base64 } = body;

      if (!data && !base64) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Request must include "data" (object) or "base64" (base64 string) containing the backup payload.' }) };
      }

      let dump;
      if (base64) {
        try {
          const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
          dump = JSON.parse(jsonStr);
        } catch (err) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid base64 data: ' + err.message }) };
        }
      } else {
        dump = data;
      }

      // Validate the dump structure
      if (!dump || !dump.stores || !dump.stores.auth) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid backup format: missing "stores.auth" in backup data.' }) };
      }

      console.log(`[blob-backup] Restore requested by ${session.email}. Data: ${JSON.stringify({
        users: Object.keys(dump.stores.auth.users || {}).length,
        payments: Object.keys(dump.stores.auth.payments || {}).length,
      })}`);

      const authStore = await getStore(event);
      const blogStore = await getBlogStore(event);
      const results = { restored: {}, errors: [] };

      // ──────────────────────────────────────────────
      // Restore AUTH store data
      // ──────────────────────────────────────────────
      const authData = dump.stores.auth;

      // 1. Restore users:list
      if (authData['users:list']) {
        await authStore.setJSON('users:list', authData['users:list']);
        results.restored['users:list'] = authData['users:list'].length;
      }

      // 2. Restore each user:{email}
      if (authData.users) {
        let userCount = 0;
        for (const [email, userData] of Object.entries(authData.users)) {
          try {
            await authStore.setJSON(`user:${email}`, userData);
            userCount++;
          } catch (err) {
            results.errors.push(`Failed to restore user ${email}: ${err.message}`);
          }
        }
        results.restored.users = userCount;
      }

      // 3. Restore payments:list
      if (authData['payments:list']) {
        await authStore.setJSON('payments:list', authData['payments:list']);
        results.restored['payments:list'] = authData['payments:list'].length;
      }

      // 4. Restore each payment:{paymentId}
      if (authData.payments) {
        let paymentCount = 0;
        for (const [paymentId, paymentData] of Object.entries(authData.payments)) {
          try {
            await authStore.setJSON(`payment:${paymentId}`, paymentData);
            paymentCount++;
          } catch (err) {
            results.errors.push(`Failed to restore payment ${paymentId}: ${err.message}`);
          }
        }
        results.restored.payments = paymentCount;
      }

      // 5. Restore receipts:map
      if (authData['receipts:map']) {
        await authStore.setJSON('receipts:map', authData['receipts:map']);
        results.restored['receipts:map'] = Object.keys(authData['receipts:map']).length;
      }

      // 6. Restore thankletter_template
      if (authData['thankletter_template'] !== undefined && authData['thankletter_template'] !== null) {
        await authStore.set('thankletter_template', authData['thankletter_template']);
        results.restored['thankletter_template'] = true;
      }

      // ──────────────────────────────────────────────
      // Restore BLOG store data
      // ──────────────────────────────────────────────
      if (blogStore && dump.stores.blog) {
        const blogData = dump.stores.blog;

        // blog:index
        if (blogData['blog:index']) {
          await blogStore.setJSON('blog:index', blogData['blog:index']);
          results.restored['blog:index'] = blogData['blog:index'].posts ? blogData['blog:index'].posts.length : 0;
        }

        // each blog:post:{slug}
        if (blogData.blogs) {
          let blogCount = 0;
          for (const [slug, blogPost] of Object.entries(blogData.blogs)) {
            try {
              await blogStore.setJSON(`blog:post:${slug}`, blogPost);
              blogCount++;
            } catch (err) {
              results.errors.push(`Failed to restore blog post ${slug}: ${err.message}`);
            }
          }
          results.restored.blogs = blogCount;
        }

        // blog:comments:{slug} — comment index per slug
        if (blogData['comments:by-slug']) {
          let commentIndexCount = 0;
          for (const [slug, commentIds] of Object.entries(blogData['comments:by-slug'])) {
            try {
              await blogStore.setJSON(`blog:comments:${slug}`, commentIds);
              commentIndexCount++;
            } catch (err) {
              results.errors.push(`Failed to restore comment index for ${slug}: ${err.message}`);
            }
          }
          results.restored['comments:by-slug'] = commentIndexCount;
        }

        // each blog:comment:{slug}:{commentId}
        if (blogData.comments) {
          let commentCount = 0;
          for (const [key, commentData] of Object.entries(blogData.comments)) {
            try {
              // key format is "slug:commentId"
              await blogStore.setJSON(`blog:comment:${key}`, commentData);
              commentCount++;
            } catch (err) {
              results.errors.push(`Failed to restore comment ${key}: ${err.message}`);
            }
          }
          results.restored.comments = commentCount;
        }

        // blog:pending-comments
        if (blogData['pending-comments']) {
          await blogStore.setJSON('blog:pending-comments', blogData['pending-comments']);
          results.restored['pending-comments'] = blogData['pending-comments'].length;
        }
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          message: '✅ Data restored successfully.',
          results,
          exportedAt: dump.exportedAt,
          exportedBy: dump.exportedAt ? 'backup file from ' + dump.exportedAt : 'unknown',
        }),
      };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed. Use GET (export) or POST (restore).' }) };

  } catch (err) {
    console.error('[blob-backup] Error:', err.message, err.stack);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};