// Netlify Function: GET/POST /razorpay/blob-backup
// System admin only (hardcoded): Export and restore ALL blob data:
//   auth (users, payments, receipts map, thankletter templates, donor wall),
//   blog (posts, comments),
//   bank (transactions, narration mappings),
//   expense (expense records + supporting documents).
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
const { getBankStore } = require('./bank-store');
const { getExpenseStore } = require('./expense-store');

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
 * Export ALL blob data from auth, blog, bank, and expense stores.
 * Returns a complete dump object.
 */
async function exportAllData(event) {
  const authStore = await getStore(event);
  const blogStore = await getBlogStore(event);
  const bankStore = await getBankStore(event);
  const expenseStore = await getExpenseStore(event);

  const dump = {
    exportedAt: new Date().toISOString(),
    version: 2,
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

  // thankletter_template (legacy single template)
  const thankletterTemplate = await authStore.get('thankletter_template', { type: 'text' });
  if (thankletterTemplate !== null && thankletterTemplate !== undefined) {
    authData['thankletter_template'] = thankletterTemplate;
  }

  // ── New: Multi-template feature ──
  // thankletter_template:list — the metadata list of ALL templates
  const templateList = await authStore.get('thankletter_template:list', { type: 'text' });
  if (templateList !== null && templateList !== undefined) {
    // Keep as the raw JSON text so it round-trips exactly.
    authData['thankletter_template:list'] = templateList;
  }

  // each thankletter_template:{id} — individual template content (text)
  const thankletterTemplates = {};
  {
    let listIds = [];
    try {
      const parsed = templateList ? JSON.parse(templateList) : [];
      if (Array.isArray(parsed)) {
        listIds = parsed.map(t => t.id).filter(Boolean);
      }
    } catch (_) {}
    // Always include the legacy id so it's covered even if list is empty/corrupt
    if (!listIds.includes('thank_letter_legacy')) {
      listIds.push('thank_letter_legacy');
    }
    for (const id of listIds) {
      try {
        const content = await authStore.get(`thankletter_template:${id}`, { type: 'text' });
        if (content !== null && content !== undefined) {
          thankletterTemplates[id] = content;
        }
      } catch (_) {}
    }
  }
  authData['thankletter_templates'] = thankletterTemplates;

  // ── New: Donor wall data (auth store) ──
  const donorWall = await authStore.get('donor-wall', { type: 'json' });
  if (donorWall) authData['donor-wall'] = donorWall;

  const donorWallExcluded = await authStore.get('donor-wall-excluded', { type: 'json' });
  if (donorWallExcluded) authData['donor-wall-excluded'] = donorWallExcluded;

  const donorWallManual = await authStore.get('donor-wall-manual', { type: 'json' });
  if (donorWallManual) authData['donor-wall-manual'] = donorWallManual;

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

  // ── Bank store data ──
  if (bankStore) {
    const bankData = {};

    // transactions:list — list of transaction keys
    const transactionsList = await bankStore.get('transactions:list', { type: 'json' }) || [];
    bankData['transactions:list'] = transactionsList;

    // each transaction:{key}
    const transactions = {};
    for (const key of transactionsList) {
      try {
        const txn = await bankStore.get(`transaction:${key}`, { type: 'json' });
        if (txn) {
          transactions[key] = txn;
        }
      } catch (_) {}
    }
    bankData.transactions = transactions;

    // narration-mapping:list — list of mapping keys
    const narMappingsList = await bankStore.get('narration-mapping:list', { type: 'json' }) || [];
    bankData['narration-mapping:list'] = narMappingsList;

    // each narration-mapping:{key}
    const narMappings = {};
    for (const key of narMappingsList) {
      try {
        const mapping = await bankStore.get(`narration-mapping:${key}`, { type: 'json' });
        if (mapping) {
          narMappings[key] = mapping;
        }
      } catch (_) {}
    }
    bankData['narration-mappings'] = narMappings;

    dump.stores.bank = bankData;
  }

  // ── Expense store data ──
  if (expenseStore) {
    const expenseData = {};

    // expenses:list — list of expense keys
    const expensesList = await expenseStore.get('expenses:list', { type: 'json' }) || [];
    expenseData['expenses:list'] = expensesList;

    // each expense:{key}
    const expenses = {};
    let documentIds = [];
    for (const key of expensesList) {
      try {
        const expense = await expenseStore.get(`expense:${key}`, { type: 'json' });
        if (expense) {
          expenses[key] = expense;
          // Collect document IDs referenced by this expense
          if (Array.isArray(expense.documents)) {
            for (const doc of expense.documents) {
              if (doc && doc.id) documentIds.push(doc.id);
            }
          }
        }
      } catch (_) {}
    }
    expenseData.expenses = expenses;

    // each document:{docId} — binary blobs, stored as base64 + metadata
    const documents = {};
    const seenDocIds = new Set();
    for (const docId of documentIds) {
      if (seenDocIds.has(docId)) continue;
      seenDocIds.add(docId);
      try {
        const blob = await expenseStore.get(`document:${docId}`);
        if (blob) {
          const metadata = blob.metadata || {};
          const data = await blob.arrayBuffer();
          const buffer = Buffer.from(data);
          documents[docId] = {
            base64: buffer.toString('base64'),
            contentType: metadata.contentType || 'application/octet-stream',
            filename: metadata.filename || 'document',
            size: buffer.length,
          };
        }
      } catch (_) {}
    }
    expenseData.documents = documents;

    dump.stores.expense = expenseData;
  }

  return dump;
}

/**
 * Restore data in REPLACE mode.
 * Overwrites all list/index keys with backup data, then deletes orphaned individual records
 * that exist in the store but are not in the backup.
 */
async function restoreReplace(authStore, blogStore, bankStore, expenseStore, dump, results) {
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

  // 10. Overwrite legacy thankletter_template
  if (authData['thankletter_template'] !== undefined && authData['thankletter_template'] !== null) {
    await authStore.set('thankletter_template', authData['thankletter_template']);
    results.restored['thankletter_template'] = true;
  }

  // ── New: thankletter_template:list + all individual templates ──
  // Load current list to find orphan template ids
  const currentTemplateListRaw = await authStore.get('thankletter_template:list', { type: 'text' });
  let currentTemplateIds = [];
  try {
    const parsed = currentTemplateListRaw ? JSON.parse(currentTemplateListRaw) : [];
    if (Array.isArray(parsed)) currentTemplateIds = parsed.map(t => t.id).filter(Boolean);
  } catch (_) {}
  if (!currentTemplateIds.includes('thank_letter_legacy')) {
    currentTemplateIds.push('thank_letter_legacy');
  }

  if (authData['thankletter_template:list'] !== undefined && authData['thankletter_template:list'] !== null) {
    await authStore.set('thankletter_template:list', authData['thankletter_template:list']);
    results.restored['thankletter_template:list'] = true;
  }

  const backupTemplateIds = new Set(Object.keys(authData['thankletter_templates'] || {}));
  if (authData['thankletter_templates']) {
    let templateCount = 0;
    for (const [id, content] of Object.entries(authData['thankletter_templates'])) {
      try {
        await authStore.set(`thankletter_template:${id}`, content);
        templateCount++;
      } catch (err) {
        results.errors.push(`Failed to restore thankletter template ${id}: ${err.message}`);
      }
    }
    results.restored['thankletter_templates'] = templateCount;
  }

  // Delete orphaned template content (ids in current but not in backup — except protected legacy which is auto-managed)
  let deletedTemplates = 0;
  for (const id of currentTemplateIds) {
    if (!backupTemplateIds.has(id) && id !== 'thank_letter_legacy') {
      try {
        await authStore.delete(`thankletter_template:${id}`);
        deletedTemplates++;
      } catch (err) {
        results.errors.push(`Failed to delete orphaned template ${id}: ${err.message}`);
      }
    }
  }
  if (deletedTemplates > 0) {
    results.restored['orphaned-templates-deleted'] = deletedTemplates;
  }

  // ── New: Donor wall data (replace=overwrite / clear if absent) ──
  // Current values, cleared in replace mode even if backup has no donor-wall
  if (authData['donor-wall'] !== undefined) {
    await authStore.setJSON('donor-wall', authData['donor-wall']);
    results.restored['donor-wall'] = true;
  } else {
    await authStore.delete('donor-wall').catch(() => {});
    results.restored['donor-wall'] = 'cleared';
  }

  if (authData['donor-wall-excluded'] !== undefined) {
    await authStore.setJSON('donor-wall-excluded', authData['donor-wall-excluded']);
    results.restored['donor-wall-excluded'] = true;
  } else {
    await authStore.delete('donor-wall-excluded').catch(() => {});
    results.restored['donor-wall-excluded'] = 'cleared';
  }

  if (authData['donor-wall-manual'] !== undefined) {
    await authStore.setJSON('donor-wall-manual', authData['donor-wall-manual']);
    results.restored['donor-wall-manual'] = true;
  } else {
    await authStore.delete('donor-wall-manual').catch(() => {});
    results.restored['donor-wall-manual'] = 'cleared';
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

  // ── BANK store ──
  if (bankStore && dump.stores.bank) {
    const bankData = dump.stores.bank;

    // Get current lists before overwriting
    const currentTxnList = await bankStore.get('transactions:list', { type: 'json' }) || [];
    const currentMappingList = await bankStore.get('narration-mapping:list', { type: 'json' }) || [];

    // Overwrite transactions:list
    if (bankData['transactions:list']) {
      await bankStore.setJSON('transactions:list', bankData['transactions:list']);
      results.restored['transactions:list'] = bankData['transactions:list'].length;
    }

    // Overwrite each transaction:{key} and track which are in backup
    const backupTxnKeys = new Set(Object.keys(bankData.transactions || {}));
    if (bankData.transactions) {
      let txnCount = 0;
      for (const [key, txnData] of Object.entries(bankData.transactions)) {
        try {
          await bankStore.setJSON(`transaction:${key}`, txnData);
          txnCount++;
        } catch (err) {
          results.errors.push(`Failed to restore bank transaction ${key}: ${err.message}`);
        }
      }
      results.restored.bank_transactions = txnCount;
    }

    // Delete orphaned bank transactions
    let deletedTxns = 0;
    for (const key of currentTxnList) {
      if (!backupTxnKeys.has(key)) {
        try {
          await bankStore.delete(`transaction:${key}`);
          deletedTxns++;
        } catch (err) {
          results.errors.push(`Failed to delete orphaned bank transaction ${key}: ${err.message}`);
        }
      }
    }
    if (deletedTxns > 0) {
      results.restored['orphaned-bank-transactions-deleted'] = deletedTxns;
    }

    // Overwrite narration-mapping:list
    if (bankData['narration-mapping:list']) {
      await bankStore.setJSON('narration-mapping:list', bankData['narration-mapping:list']);
      results.restored['narration-mapping:list'] = bankData['narration-mapping:list'].length;
    }

    // Overwrite each narration-mapping:{key}
    const backupMappingKeys = new Set(Object.keys(bankData['narration-mappings'] || {}));
    if (bankData['narration-mappings']) {
      let mappingCount = 0;
      for (const [key, mappingData] of Object.entries(bankData['narration-mappings'])) {
        try {
          await bankStore.setJSON(`narration-mapping:${key}`, mappingData);
          mappingCount++;
        } catch (err) {
          results.errors.push(`Failed to restore narration mapping ${key}: ${err.message}`);
        }
      }
      results.restored.narration_mappings = mappingCount;
    }

    // Delete orphaned narration mappings
    let deletedMappings = 0;
    for (const key of currentMappingList) {
      if (!backupMappingKeys.has(key)) {
        try {
          await bankStore.delete(`narration-mapping:${key}`);
          deletedMappings++;
        } catch (err) {
          results.errors.push(`Failed to delete orphaned narration mapping ${key}: ${err.message}`);
        }
      }
    }
    if (deletedMappings > 0) {
      results.restored['orphaned-narration-mappings-deleted'] = deletedMappings;
    }
  }

  // ── EXPENSE store ──
  if (expenseStore && dump.stores.expense) {
    const expenseData = dump.stores.expense;

    // Get current list and current document IDs before overwriting (for orphan cleanup)
    const currentExpenseList = await expenseStore.get('expenses:list', { type: 'json' }) || [];
    const currentDocIds = new Set();
    for (const key of currentExpenseList) {
      try {
        const expense = await expenseStore.get(`expense:${key}`, { type: 'json' });
        if (expense && Array.isArray(expense.documents)) {
          for (const doc of expense.documents) {
            if (doc && doc.id) currentDocIds.add(doc.id);
          }
        }
      } catch (_) {}
    }

    // Overwrite expenses:list
    if (expenseData['expenses:list']) {
      await expenseStore.setJSON('expenses:list', expenseData['expenses:list']);
      results.restored['expenses:list'] = expenseData['expenses:list'].length;
    }

    // Overwrite each expense:{key} and track which are in backup
    const backupExpenseKeys = new Set(Object.keys(expenseData.expenses || {}));
    if (expenseData.expenses) {
      let expenseCount = 0;
      for (const [key, expenseDataEntry] of Object.entries(expenseData.expenses)) {
        try {
          await expenseStore.setJSON(`expense:${key}`, expenseDataEntry);
          expenseCount++;
        } catch (err) {
          results.errors.push(`Failed to restore expense ${key}: ${err.message}`);
        }
      }
      results.restored.expenses = expenseCount;
    }

    // Delete orphaned expense records
    let deletedExpenses = 0;
    for (const key of currentExpenseList) {
      if (!backupExpenseKeys.has(key)) {
        try {
          await expenseStore.delete(`expense:${key}`);
          deletedExpenses++;
        } catch (err) {
          results.errors.push(`Failed to delete orphaned expense ${key}: ${err.message}`);
        }
      }
    }
    if (deletedExpenses > 0) {
      results.restored['orphaned-expenses-deleted'] = deletedExpenses;
    }

    // Restore documents (binary blobs)
    const backupDocIds = new Set(Object.keys(expenseData.documents || {}));
    if (expenseData.documents) {
      let docCount = 0;
      for (const [docId, docData] of Object.entries(expenseData.documents)) {
        try {
          const buffer = Buffer.from(docData.base64 || '', 'base64');
          await expenseStore.set(`document:${docId}`, buffer, {
            metadata: {
              contentType: docData.contentType || 'application/octet-stream',
              filename: docData.filename || 'document',
              size: buffer.length,
              restoredFromBackup: true,
              restoredAt: new Date().toISOString(),
            },
          });
          docCount++;
        } catch (err) {
          results.errors.push(`Failed to restore document ${docId}: ${err.message}`);
        }
      }
      results.restored.documents = docCount;
    }

    // Delete orphaned documents: remove docs that were referenced by the pre-restore
    // expenses but are not present in the backup. We captured `currentDocIds` before
    // overwriting, so we can safely iterate that set.
    let deletedDocs = 0;
    const deletedDocIds = new Set();
    for (const id of currentDocIds) {
      if (!backupDocIds.has(id) && !deletedDocIds.has(id)) {
        deletedDocIds.add(id);
        try {
          await expenseStore.delete(`document:${id}`);
          deletedDocs++;
        } catch (_) {}
      }
    }
    if (deletedDocs > 0) {
      results.restored['orphaned-documents-deleted'] = deletedDocs;
    }
  }
}

/**
 * Restore data in MERGE mode.
 * Merges backup data with existing data — keeps both old and new records.
 */
async function restoreMerge(authStore, blogStore, bankStore, expenseStore, dump, results) {
  const storeData = dump.stores.auth;

  // ── AUTH store ──

  // 1. Merge users:list (deduplicated)
  if (storeData['users:list']) {
    const existingUsersList = await authStore.get('users:list', { type: 'json' }) || [];
    const existingSet = new Set(existingUsersList);
    let addedCount = 0;
    for (const email of storeData['users:list']) {
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
  if (storeData.users) {
    let userCount = 0;
    for (const [email, userData] of Object.entries(storeData.users)) {
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
  if (storeData['payments:list']) {
    const existingPaymentsList = await authStore.get('payments:list', { type: 'json' }) || [];
    const existingSet = new Set(existingPaymentsList);
    let addedCount = 0;
    for (const paymentId of storeData['payments:list']) {
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
  if (storeData.payments) {
    let paymentCount = 0;
    for (const [paymentId, paymentData] of Object.entries(storeData.payments)) {
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
  if (storeData['receipts:map']) {
    const existingReceiptsMap = await authStore.get('receipts:map', { type: 'json' }) || {};
    const beforeCount = Object.keys(existingReceiptsMap).length;
    Object.assign(existingReceiptsMap, storeData['receipts:map']);
    await authStore.setJSON('receipts:map', existingReceiptsMap);
    const afterCount = Object.keys(existingReceiptsMap).length;
    results.restored['receipts:map'] = { total: afterCount, added: afterCount - beforeCount };
  }

  // 6. Merge legacy thankletter_template (backup overwrites if present)
  if (storeData['thankletter_template'] !== undefined && storeData['thankletter_template'] !== null) {
    await authStore.set('thankletter_template', storeData['thankletter_template']);
    results.restored['thankletter_template'] = true;
  }

  // ── New: Merge thank-you templates list + individual templates ──
  if (storeData['thankletter_template:list'] !== undefined && storeData['thankletter_template:list'] !== null) {
    let existingList = [];
    try {
      const raw = await authStore.get('thankletter_template:list', { type: 'text' });
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) existingList = parsed;
    } catch (_) {
      existingList = [];
    }

    let backupList = [];
    try {
      const parsed = JSON.parse(storeData['thankletter_template:list']);
      if (Array.isArray(parsed)) backupList = parsed;
    } catch (_) {}

    const existingIds = new Set(existingList.map(t => t.id));
    let addedCount = 0;
    for (const t of backupList) {
      if (t && t.id && !existingIds.has(t.id)) {
        existingList.push(t);
        existingIds.add(t.id);
        addedCount++;
      }
    }
    await authStore.set('thankletter_template:list', JSON.stringify(existingList));
    results.restored['thankletter_template:list'] = { total: existingList.length, added: addedCount };
  }

  if (storeData['thankletter_templates']) {
    let templateCount = 0;
    for (const [id, content] of Object.entries(storeData['thankletter_templates'])) {
      try {
        await authStore.set(`thankletter_template:${id}`, content);
        templateCount++;
      } catch (err) {
        results.errors.push(`Failed to merge thankletter template ${id}: ${err.message}`);
      }
    }
    results.restored['thankletter_templates'] = templateCount;
  }

  // ── New: Merge donor wall data ──
  if (storeData['donor-wall'] !== undefined && storeData['donor-wall'] !== null) {
    await authStore.setJSON('donor-wall', storeData['donor-wall']);
    results.restored['donor-wall'] = true;
  }
  if (storeData['donor-wall-excluded'] !== undefined && storeData['donor-wall-excluded'] !== null) {
    await authStore.setJSON('donor-wall-excluded', storeData['donor-wall-excluded']);
    results.restored['donor-wall-excluded'] = true;
  }
  if (storeData['donor-wall-manual'] !== undefined && storeData['donor-wall-manual'] !== null) {
    await authStore.setJSON('donor-wall-manual', storeData['donor-wall-manual']);
    results.restored['donor-wall-manual'] = true;
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

  // ── BANK store ──
  if (bankStore && dump.stores.bank) {
    const bankData = dump.stores.bank;

    // Merge transactions:list (deduplicated)
    if (bankData['transactions:list']) {
      const existingList = await bankStore.get('transactions:list', { type: 'json' }) || [];
      const existingSet = new Set(existingList);
      let addedCount = 0;
      for (const key of bankData['transactions:list']) {
        if (!existingSet.has(key)) {
          existingList.push(key);
          existingSet.add(key);
          addedCount++;
        }
      }
      await bankStore.setJSON('transactions:list', existingList);
      results.restored['transactions:list'] = { total: existingList.length, added: addedCount };
    }

    // Merge each transaction:{key}
    if (bankData.transactions) {
      let txnCount = 0;
      for (const [key, txnData] of Object.entries(bankData.transactions)) {
        try {
          await bankStore.setJSON(`transaction:${key}`, txnData);
          txnCount++;
        } catch (err) {
          results.errors.push(`Failed to merge bank transaction ${key}: ${err.message}`);
        }
      }
      results.restored.bank_transactions = txnCount;
    }

    // Merge narration-mapping:list (deduplicated)
    if (bankData['narration-mapping:list']) {
      const existingList = await bankStore.get('narration-mapping:list', { type: 'json' }) || [];
      const existingSet = new Set(existingList);
      let addedCount = 0;
      for (const key of bankData['narration-mapping:list']) {
        if (!existingSet.has(key)) {
          existingList.push(key);
          existingSet.add(key);
          addedCount++;
        }
      }
      await bankStore.setJSON('narration-mapping:list', existingList);
      results.restored['narration-mapping:list'] = { total: existingList.length, added: addedCount };
    }

    // Merge each narration-mapping:{key}
    if (bankData['narration-mappings']) {
      let mappingCount = 0;
      for (const [key, mappingData] of Object.entries(bankData['narration-mappings'])) {
        try {
          await bankStore.setJSON(`narration-mapping:${key}`, mappingData);
          mappingCount++;
        } catch (err) {
          results.errors.push(`Failed to merge narration mapping ${key}: ${err.message}`);
        }
      }
      results.restored.narration_mappings = mappingCount;
    }
  }

  // ── EXPENSE store ──
  if (expenseStore && dump.stores.expense) {
    const expenseData = dump.stores.expense;

    // Merge expenses:list (deduplicated)
    if (expenseData['expenses:list']) {
      const existingList = await expenseStore.get('expenses:list', { type: 'json' }) || [];
      const existingSet = new Set(existingList);
      let addedCount = 0;
      for (const key of expenseData['expenses:list']) {
        if (!existingSet.has(key)) {
          existingList.push(key);
          existingSet.add(key);
          addedCount++;
        }
      }
      await expenseStore.setJSON('expenses:list', existingList);
      results.restored['expenses:list'] = { total: existingList.length, added: addedCount };
    }

    // Merge each expense:{key}
    if (expenseData.expenses) {
      let expenseCount = 0;
      for (const [key, expenseDataEntry] of Object.entries(expenseData.expenses)) {
        try {
          await expenseStore.setJSON(`expense:${key}`, expenseDataEntry);
          expenseCount++;
        } catch (err) {
          results.errors.push(`Failed to merge expense ${key}: ${err.message}`);
        }
      }
      results.restored.expenses = expenseCount;
    }

    // Merge documents (binary blobs)
    if (expenseData.documents) {
      let docCount = 0;
      for (const [docId, docData] of Object.entries(expenseData.documents)) {
        try {
          const buffer = Buffer.from(docData.base64 || '', 'base64');
          await expenseStore.set(`document:${docId}`, buffer, {
            metadata: {
              contentType: docData.contentType || 'application/octet-stream',
              filename: docData.filename || 'document',
              size: buffer.length,
              restoredFromMerge: true,
              restoredAt: new Date().toISOString(),
            },
          });
          docCount++;
        } catch (err) {
          results.errors.push(`Failed to merge document ${docId}: ${err.message}`);
        }
      }
      results.restored.documents = docCount;
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

      const stats = {
        users: Object.keys(dump.stores.auth.users || {}).length,
        payments: Object.keys(dump.stores.auth.payments || {}).length,
        receipts: Object.keys(dump.stores.auth['receipts:map'] || {}).length,
        hasThankletterTemplate: !!dump.stores.auth['thankletter_template'],
        thankletterTemplates: Object.keys(dump.stores.auth['thankletter_templates'] || {}).length,
        donorWall: !!dump.stores.auth['donor-wall'],
        donorWallExcluded: dump.stores.auth['donor-wall-excluded'] ? (dump.stores.auth['donor-wall-excluded'].excluded || []).length : 0,
        donorWallManual: dump.stores.auth['donor-wall-manual'] ? (dump.stores.auth['donor-wall-manual'].donors || []).length : 0,
        blogs: dump.stores.blog ? Object.keys(dump.stores.blog.blogs || {}).length : 0,
        comments: dump.stores.blog ? Object.keys(dump.stores.blog.comments || {}).length : 0,
        bankTransactions: dump.stores.bank ? Object.keys(dump.stores.bank.transactions || {}).length : 0,
        narrationMappings: dump.stores.bank ? Object.keys(dump.stores.bank['narration-mappings'] || {}).length : 0,
        expenses: dump.stores.expense ? Object.keys(dump.stores.expense.expenses || {}).length : 0,
        documents: dump.stores.expense ? Object.keys(dump.stores.expense.documents || {}).length : 0,
      };

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
          stats,
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

      console.log(`[blob-backup] Restore (mode=${restoreMode}) requested by ${session.email}. Summary: ${JSON.stringify({
        users: Object.keys(dump.stores.auth.users || {}).length,
        payments: Object.keys(dump.stores.auth.payments || {}).length,
        bankTransactions: dump.stores.bank ? Object.keys(dump.stores.bank.transactions || {}).length : 0,
        expenses: dump.stores.expense ? Object.keys(dump.stores.expense.expenses || {}).length : 0,
      })}`);

      const authStore = await getStore(event);
      const blogStore = await getBlogStore(event);
      const bankStore = await getBankStore(event);
      const expenseStore = await getExpenseStore(event);
      const results = { restored: {}, errors: [], mode: restoreMode };

      if (restoreMode === 'merge') {
        await restoreMerge(authStore, blogStore, bankStore, expenseStore, dump, results);
      } else {
        await restoreReplace(authStore, blogStore, bankStore, expenseStore, dump, results);
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