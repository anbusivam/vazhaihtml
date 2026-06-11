// Netlify Function: /blog/comment
// POST   — submit a comment (requires auth)
// GET    — list comments for a post slug (public: approved only; with auth: includes pending for author/admin)
// POST /approve — approve a pending comment (post author or admin only)
// POST /edit    — edit a comment text (comment author or admin only)
// GET /pending  — get all pending comments globally (admin only)
const { getBlogStore } = require('./blog-store');
const { getSession, getUserRoles, handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // ── Path routing ──────────────────────────────────────────────
  const path = (event.path || '').replace(/\/\.netlify\/functions\/blog-comment/, '/blog/comment');
  const isApprove = path.endsWith('/approve');
  const isPending = path.endsWith('/pending') || event.queryStringParameters?.pending === 'true';
  const isEdit = path.endsWith('/edit');

  try {
    const store = await getBlogStore(event);

    // ── GET: Retrieve comments ──────────────────────────────────
    if (event.httpMethod === 'GET') {
      if (isPending) {
        return await handleGetPendingComments(store, event);
      }

      const params = new URLSearchParams(event.queryStringParameters || {});
      const slug = params.get('slug');
      if (!slug) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing slug parameter' }),
        };
      }

      const comments = await getComments(store, slug);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ comments }),
      };
    }

    // ── POST: Submit a comment or approve a comment or edit a comment ──
    if (event.httpMethod === 'POST') {
      if (isApprove) {
        return await handleApproveComment(store, event);
      }

      if (isEdit) {
        return await handleEditComment(store, event);
      }

      // ── Submit a comment ──────────────────────────────────────
      const authHeader = event.headers['authorization'] || '';
      const cookies = event.headers['cookie'] || '';

      let token = null;
      const match = cookies.match(/vazhai_session=([^;]+)/);
      if (match) token = match[1];
      if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);

      if (!token) {
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Authentication required' }),
        };
      }

      // Validate session via auth-store
      const { getStore, ADMIN_EMAILS } = require('./auth-store');
      const authStore = await getStore(event);
      const session = await authStore.get(`session:${token}`, { type: 'json' });

      if (!session || Date.now() > session.expiresAt) {
        if (session) await authStore.delete(`session:${token}`);
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Session expired. Please log in again.' }),
        };
      }

      // Parse request body
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Invalid JSON body' }),
        };
      }

      const slug = (body.slug || '').trim();
      const text = (body.text || '').trim();

      if (!slug || !text) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing slug or text' }),
        };
      }

      if (text.length > 2000) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Comment too long (max 2000 characters)' }),
        };
      }

      // Get user display name and roles
      const userData = await authStore.get(`user:${session.email}`, { type: 'json' });
      const userName = (userData && userData.name) || session.email.split('@')[0];
      const roles = await getUserRoles(authStore, session.email);

      // Determine if auto-approved (bloggers auto-approve, others need approval)
      const isBlogger = roles.includes('blogger') || roles.includes('admin');
      const autoApproved = isBlogger;

      // Create comment
      const id = Date.now().toString() + '-' + Math.random().toString(36).slice(2, 6);
      const comment = {
        id,
        slug,
        email: session.email,
        name: userName,
        text,
        createdAt: new Date().toISOString(),
        approved: autoApproved,
      };

      // Store comment in blobs
      await store.setJSON(`blog:comment:${slug}:${id}`, comment);

      // Append to comment index for this slug
      const indexKey = `blog:comments:${slug}`;
      const existingIndex = await store.get(indexKey, { type: 'json' });
      const indexList = Array.isArray(existingIndex) ? existingIndex : [];
      indexList.push(id);
      await store.setJSON(indexKey, indexList);

      // If not auto-approved, add to global pending comments list (for admin dashboard)
      if (!autoApproved) {
        // Get the post title for display in admin list
        const post = await store.get(`blog:post:${slug}`, { type: 'json' });
        const postTitle = post ? post.title : slug;

        const pendingKey = 'blog:pending-comments';
        const pendingList = await store.get(pendingKey, { type: 'json' }) || [];
        pendingList.push({
          commentId: id,
          slug,
          email: session.email,
          name: userName,
          text,
          createdAt: comment.createdAt,
          postTitle,
        });
        await store.setJSON(pendingKey, pendingList);
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          comment: { ...comment, approved: autoApproved },
          ok: true,
          approved: autoApproved,
        }),
      };
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (err) {
    console.error('[blog-comment] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};

// ── GET: Pending comments (admin only) ───────────────────────────────
async function handleGetPendingComments(store, event) {
  try {
    const authStore = require('./auth-store').getStore;
    const aStore = await authStore(event);
    const session = await getSession(aStore, event);
    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const roles = await getUserRoles(aStore, session.email);
    const isAdmin = roles.includes('admin');

    if (!isAdmin) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: admin access required' }) };
    }

    const pendingKey = 'blog:pending-comments';
    const pendingList = await store.get(pendingKey, { type: 'json' }) || [];

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ pendingComments: pendingList }),
    };
  } catch (err) {
    console.error('[blog-comment] handleGetPendingComments error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
}

// ── POST: Approve a comment (post author or admin only) ──────────────
async function handleApproveComment(store, event) {
  try {
    const authStore = require('./auth-store').getStore;
    const aStore = await authStore(event);
    const session = await getSession(aStore, event);
    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { slug, commentId } = body;

    if (!slug || !commentId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing slug or commentId' }) };
    }

    // Fetch the comment
    const comment = await store.get(`blog:comment:${slug}:${commentId}`, { type: 'json' });
    if (!comment) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Comment not found' }) };
    }

    // Check authorization: admin or post author can approve
    const roles = await getUserRoles(aStore, session.email);
    const isAdmin = roles.includes('admin');
    const post = await store.get(`blog:post:${slug}`, { type: 'json' });
    const isAuthor = post && post.author === session.email;

    if (!isAdmin && !isAuthor) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: only post author or admin can approve comments' }) };
    }

    // Update the comment to approved
    comment.approved = true;
    await store.setJSON(`blog:comment:${slug}:${commentId}`, comment);

    // Remove from global pending list
    const pendingKey = 'blog:pending-comments';
    const pendingList = await store.get(pendingKey, { type: 'json' }) || [];
    const updatedPending = pendingList.filter(p => !(p.slug === slug && p.commentId === commentId));
    await store.setJSON(pendingKey, updatedPending);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, comment, message: 'Comment approved.' }),
    };
  } catch (err) {
    console.error('[blog-comment] handleApproveComment error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
}

// ── POST: Edit a comment (comment author or admin only) ──────────────
async function handleEditComment(store, event) {
  try {
    const authStore = require('./auth-store').getStore;
    const aStore = await authStore(event);
    const session = await getSession(aStore, event);
    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { slug, commentId, text } = body;

    if (!slug || !commentId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing slug or commentId' }) };
    }

    if (!text || !text.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Comment text cannot be empty' }) };
    }

    if (text.length > 2000) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Comment too long (max 2000 characters)' }) };
    }

    // Fetch the comment
    const comment = await store.get(`blog:comment:${slug}:${commentId}`, { type: 'json' });
    if (!comment) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Comment not found' }) };
    }

    // Check authorization: comment author or admin can edit
    const roles = await getUserRoles(aStore, session.email);
    const isAdmin = roles.includes('admin');
    const isCommentAuthor = comment.email === session.email;

    if (!isAdmin && !isCommentAuthor) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden: only comment author or admin can edit this comment' }) };
    }

    // Determine if the comment author is a blogger/admin (auto-approved).
    // Use getUserRoles which handles roles array, role string, and ADMIN_EMAILS.
    const commentAuthorRoles = await getUserRoles(aStore, comment.email);
    const isCommentAuthorBlogger = commentAuthorRoles.includes('blogger') || commentAuthorRoles.includes('admin');

    // Update the comment text and mark as edited
    comment.text = text.trim();
    comment.editedAt = new Date().toISOString();

    // If the comment author is not a blogger/admin, reset to unapproved and add to pending
    if (!isCommentAuthorBlogger) {
      comment.approved = false;

      // Get the post title for display in admin list
      const post = await store.get(`blog:post:${slug}`, { type: 'json' });
      const postTitle = post ? post.title : slug;

      const pendingKey = 'blog:pending-comments';
      const pendingList = await store.get(pendingKey, { type: 'json' }) || [];

      // Remove any existing entry for this comment from the pending list
      const filteredPending = pendingList.filter(p => !(p.slug === slug && p.commentId === commentId));

      // Add updated entry to pending list
      filteredPending.push({
        commentId,
        slug,
        email: comment.email,
        name: comment.name,
        text: text.trim(),
        createdAt: comment.createdAt,
        postTitle,
      });
      await store.setJSON(pendingKey, filteredPending);
    } else {
      // If the comment was in the pending list (e.g., admin approving then editing), update its text there too
      const pendingKey = 'blog:pending-comments';
      const pendingList = await store.get(pendingKey, { type: 'json' }) || [];
      const pendingIdx = pendingList.findIndex(p => p.slug === slug && p.commentId === commentId);
      if (pendingIdx !== -1) {
        pendingList[pendingIdx].text = text.trim();
        await store.setJSON(pendingKey, pendingList);
      }
    }

    await store.setJSON(`blog:comment:${slug}:${commentId}`, comment);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, comment, message: 'Comment updated.' }),
    };
  } catch (err) {
    console.error('[blog-comment] handleEditComment error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server error.' }) };
  }
}

// ── Get comments for a post ──────────────────────────────────────────
async function getComments(store, slug) {
  try {
    const indexKey = `blog:comments:${slug}`;
    const indexList = await store.get(indexKey, { type: 'json' });
    if (!Array.isArray(indexList) || indexList.length === 0) {
      return [];
    }

    const comments = [];
    for (const id of indexList) {
      const comment = await store.get(`blog:comment:${slug}:${id}`, { type: 'json' });
      if (comment) {
        comments.push(comment);
      }
    }
    return comments;
  } catch (err) {
    console.error('[blog-comment] getComments error:', err.message);
    return [];
  }
}