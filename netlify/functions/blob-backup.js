// Netlify Function: GET/POST /razorpay/blob-backup
// System admin only (hardcoded): Export and restore ALL blob data (users, payments, receipts map, thankletter template, blog data).
// 
// GET  /razorpay/blob-backup — Exports all blob data as a downloadable JSON file.
// POST /razorpay/blob-backup — Restores blob data from uploaded JSON payload.
//   Supports two modes:
//     mode: "replace" (default) — Overwrites all data with backup contents, deletes orphaned records.
//     mode: "merge" — Merges backup data with existing data, keeping both.
//   Before restoring, the caller MUST first auto-backup existing data (download triggered client-side).
//   This two-step flow prevents accidental restore of wrong backup data.

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

/**
 * Restore data in REPLACE mode.
 * Overwrites all list/index keys with backup data, then deletes orphaned individual records
 * that exist in the store but are not in the backup.
 */
async function restoreReplace(authStore, blogStore, dump, results) {
  const authData = dump.stores.auth;

  // ── AUTH store ──

  // 1. Get current lists before overwriting (to find orphans)
  const currentUsersList = await authStore.get('users:list', { type: 'json' }) || [];
  const currentPaymentsList = await authStore.get('payments:list', { type: 'json' }) || [];
  const currentReceiptsMap = await authStore.get('receipts:map', { type: 'json' }) || {};

  // 2. Overwrite users:list
  if (authData['users:list']) {
    await authStore.setJSON('users:list', authData['users:list']);
    results.restored['users:list'] = authData['users:list'].length;
  }

  // 3. Overwrite each user:{email} and track which are in backup
  const backupUserEmails = new Set(Object.keys(authData.users || {}));
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

  // 4. Delete orphaned user records (users in current list but not in backup)
  let deletedUsers = 0;
  for (const email of currentUsersList) {
    if (!backupUserEmails.has(email)) {
      try {
        await authStore.delete(`user:${email}`);
        deletedUsers++;
      } catch (err) {
        results.errors.push(`Failed to delete orphaned user ${email}: ${err.message}`);
      }
    }
  }
  if (deletedUsers > 0) {
    results.restored['orphaned-users-deleted'] = deletedUsers;
  }

  // 5. Overwrite payments:list
  if (authData['payments:list']) {
    await authStore.setJSON('payments:list', authData['payments:list']);
    results.restored['payments:list'] = authData['payments:list'].length;
  }

  // 6. Overwrite each payment:{paymentId} and track which are in backup
  const backupPaymentIds = new Set(Object.keys(authData.payments || {}));
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

  // 7. Delete orphaned payment records
  let deletedPayments = 0;
  for (const paymentId of currentPaymentsList) {
    if (!backupPaymentIds.has(paymentId)) {
      try {
        await authStore.delete(`payment:${paymentId}`);
        deletedPayments++;
      } catch (err) {
        results.errors.push(`Failed to delete orphaned payment ${paymentId}: ${err.message}`);
      }
    }
  }
  if (deletedPayments > 0) {
    results.restored['orphaned-payments-deleted'] = deletedPayments;
  }

  // 8. Overwrite receipts:map
  if (authData['receipts:map']) {
    await authStore.setJSON('receipts:map', authData['receipts:map']);
    results.restored['receipts:map'] = Object.keys(authData['receipts:map']).length;
  }

  // 9. Delete orphaned receipt entries (receipts in current map but not in backup)
  const backupReceiptKeys = new Set(Object.keys(authData['receipts:map'] || {}));
  let deletedReceipts = 0;
  for (const key of Object.keys(currentReceiptsMap)) {
    if (!backupReceiptKeys.has(key)) {
      deletedReceipts++;
    }
  }
  if (deletedReceipts > 0) {
    results.restored['orphaned-receipts-removed'] = deletedReceipts;
  }

  // 10. Overwrite thankletter_template
  if (authData['thankletter_template'] !== undefined && authData['thankletter_template'] !== null) {
    await authStore.set('thankletter_template', authData['thankletter_template']);
    results.restored['thankletter_template'] = true;
  }

  // ── BLOG store ──
  if (blogStore && dump.stores.blog) {
    const blogData = dump.stores.blog;

    // Get current blog slugs before overwriting
    const currentBlogIndex = await blogStore.get('blog:index', { type: 'json' }) || { posts: [] };
    const currentSlugs = new Set(currentBlogIndex.posts.map(p => p.slug));

    // Overwrite blog:index
    if (blogData['blog:index']) {
      await blogStore.setJSON('blog:index', blogData['blog:index']);
      results.restored['blog:index'] = blogData['blog:index'].posts ? blogData['blog:index'].posts.length : 0;
    }

    // Overwrite each blog:post:{slug} and track which are in backup
    const backupSlugs = new Set(Object.keys(blogData.blogs || {}));
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

    // Delete orphaned blog posts
    let deletedBlogs = 0;
    for (const slug of currentSlugs) {
      if (!backupSlugs.has(slug)) {
        try {
          await blogStore.delete(`blog:post:${slug}`);
          await blogStore.delete(`blog:comments:${slug}`);
          deletedBlogs++;
        } catch (err) {
          results.errors.push(`Failed to delete orphaned blog post ${slug}: ${err.message}`);
        }
      }
    }
    if (deletedBlogs > 0) {
      results.restored['orphaned-blogs-deleted'] = deletedBlogs;
    }

    // Overwrite blog:comments:{slug}
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

    // Overwrite each blog:comment:{slug}:{commentId}
    if (blogData.comments) {
      let commentCount = 0;
      for (const [key, commentData] of Object.entries(blogData.comments)) {
        try {
          await blogStore.setJSON(`blog:comment:${key}`, commentData);
          commentCount++;
        } catch (err) {
          results.errors.push(`Failed to restore comment ${key}: ${err.message}`);
        }
      }
      results.restored.comments = commentCount;
    }

    // Overwrite blog:pending-comments
    if (blogData['pending-comments']) {
      await blogStore.setJSON('blog:pending-comments', blogData['pending-comments']);
      results.restored['pending-comments'] = blogData['pending-comments'].length;
    }
  }
}

/**
 * Restore data in MERGE mode.
 * Merges backup data with existing data — keeps both old and new records.
 */
async function restoreMerge(authStore, blogStore, dump, results) {
  const authData = dump.stores.auth;

  // ── AUTH store ──

  // 1. Merge users:list (deduplicated)
  if (authData['users:list']) {
    const existingUsersList = await authStore.get('users:list', { type: 'json' }) || [];
    const existingSet = new Set(existingUsersList);
    let addedCount = 0;
    for (const email of authData['users:list']) {
      if (!existingSet.has(email)) {
        existingUsersList.push(email);
        existingSet.add(email);
        addedCount++;
      }
    }
    await authStore.setJSON('users:list', existingUsersList);
    results.restored['users:list'] = { total: existingUsersList.length, added: addedCount };
  }

  // 2. Merge each user:{email} (backup overwrites existing, adds new)
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

  // 3. Merge payments:list (deduplicated)
  if (authData['payments:list']) {
    const existingPaymentsList = await authStore.get('payments:list', { type: 'json' }) || [];
    const existingSet = new Set(existingPaymentsList);
    let addedCount = 0;
    for (const paymentId of authData['payments:list']) {
      if (!existingSet.has(paymentId)) {
        existingPaymentsList.push(paymentId);
        existingSet.add(paymentId);
        addedCount++;
      }
    }
    await authStore.setJSON('payments:list', existingPaymentsList);
    results.restored['payments:list'] = { total: existingPaymentsList.length, added: addedCount };
  }

  // 4. Merge each payment:{paymentId} (backup overwrites existing, adds new)
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

  // 5. Merge receipts:map (backup keys overwrite existing, add new)
  if (authData['receipts:map']) {
    const existingReceiptsMap = await authStore.get('receipts:map', { type: 'json' }) || {};
    const beforeCount = Object.keys(existingReceiptsMap).length;
    Object.assign(existingReceiptsMap, authData['receipts:map']);
    await authStore.setJSON('receipts:map', existingReceiptsMap);
    const afterCount = Object.keys(existingReceiptsMap).length;
    results.restored['receipts:map'] = { total: afterCount, added: afterCount - beforeCount };
  }

  // 6. Merge thankletter_template (backup overwrites if present)
  if (authData['thankletter_template'] !== undefined && authData['thankletter_template'] !== null) {
    await authStore.set('thankletter_template', authData['thankletter_template']);
    results.restored['thankletter_template'] = true;
  }

  // ── BLOG store ──
  if (blogStore && dump.stores.blog) {
    const blogData = dump.stores.blog;

    // 7. Merge blog:index (deduplicate by slug)
    if (blogData['blog:index']) {
      const existingBlogIndex = await blogStore.get('blog:index', { type: 'json' }) || { posts: [] };
      const existingSlugs = new Set(existingBlogIndex.posts.map(p => p.slug));
      let addedCount = 0;
      for (const entry of (blogData['blog:index'].posts || [])) {
        if (!existingSlugs.has(entry.slug)) {
          existingBlogIndex.posts.push(entry);
          existingSlugs.add(entry.slug);
          addedCount++;
        }
      }
      await blogStore.setJSON('blog:index', existingBlogIndex);
      results.restored['blog:index'] = { total: existingBlogIndex.posts.length, added: addedCount };
    }

    // 8. Merge each blog:post:{slug} (backup overwrites existing, adds new)
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

    // 9. Merge blog:comments:{slug} (deduplicate comment IDs)
    if (blogData['comments:by-slug']) {
      let commentIndexCount = 0;
      for (const [slug, commentIds] of Object.entries(blogData['comments:by-slug'])) {
        try {
          const existingCommentIds = await blogStore.get(`blog:comments:${slug}`, { type: 'json' }) || [];
          const existingSet = new Set(existingCommentIds);
          for (const cid of commentIds) {
            if (!existingSet.has(cid)) {
              existingCommentIds.push(cid);
              existingSet.add(cid);
            }
          }
          await blogStore.setJSON(`blog:comments:${slug}`, existingCommentIds);
          commentIndexCount++;
        } catch (err) {
          results.errors.push(`Failed to merge comment index for ${slug}: ${err.message}`);
        }
      }
      results.restored['comments:by-slug'] = commentIndexCount;
    }

    // 10. Merge each blog:comment:{slug}:{commentId} (backup overwrites existing, adds new)
    if (blogData.comments) {
      let commentCount = 0;
      for (const [key, commentData] of Object.entries(blogData.comments)) {
        try {
          await blogStore.setJSON(`blog:comment:${key}`, commentData);
          commentCount++;
        } catch (err) {
          results.errors.push(`Failed to restore comment ${key}: ${err.message}`);
        }
      }
      results.restored.comments = commentCount;
    }

    // 11. Merge blog:pending-comments (deduplicated)
    if (blogData['pending-comments']) {
      const existingPending = await blogStore.get('blog:pending-comments', { type: 'json' }) || [];
      const existingIds = new Set(existingPending.map(c => c.id || JSON.stringify(c)));
      let addedCount = 0;
      for (const pc of blogData['pending-comments']) {
        const id = pc.id || JSON.stringify(pc);
        if (!existingIds.has(id)) {
          existingPending.push(pc);
          existingIds.add(id);
          addedCount++;
        }
      }
      await blogStore.setJSON('blog:pending-comments', existingPending);
      results.restored['pending-comments'] = { total: existingPending.length, added: addedCount };
    }
  }
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
      const { data, base64, mode } = body;

      if (!data && !base64) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Request must include "data" (object) or "base64" (base64 string) containing the backup payload.' }) };
      }

      // Validate mode: "replace" (default) or "merge"
      const restoreMode = (mode === 'merge') ? 'merge' : 'replace';

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

      console.log(`[blob-backup] Restore (mode=${restoreMode}) requested by ${session.email}. Data: ${JSON.stringify({
        users: Object.keys(dump.stores.auth.users || {}).length,
        payments: Object.keys(dump.stores.auth.payments || {}).length,
      })}`);

      const authStore = await getStore(event);
      const blogStore = await getBlogStore(event);
      const results = { restored: {}, errors: [], mode: restoreMode };

      if (restoreMode === 'merge') {
        await restoreMerge(authStore, blogStore, dump, results);
      } else {
        await restoreReplace(authStore, blogStore, dump, results);
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          message: restoreMode === 'merge'
            ? '✅ Data merged successfully. Existing data was preserved and backup data was added.'
            : '✅ Data restored successfully (replace mode). Orphaned records were cleaned up.',
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