// Netlify Function: POST /blog/save
// Creates or updates a blog post. Requires blogger or admin role.
// Bloggers can only edit their own posts. Admins can edit any post.
const { getBlogStore } = require('./blog-store');
const { requireBloggerOrAdmin, handleOptions, CORS_HEADERS } = require('./blog-auth');

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Authenticate
    const authStore = require('./auth-store').getStore;
    const store = await getBlogStore(event);
    const aStore = await authStore(event);
    const auth = await requireBloggerOrAdmin(aStore, event);
    if (!auth.authorized) {
      return { statusCode: auth.status, headers: CORS_HEADERS, body: JSON.stringify({ error: auth.error }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { slug, title, content, tags, coverImage, status, existingSlug } = body;

    // Validate
    if (!title || !title.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Title is required' }) };
    }

    // Determine slug
    let postSlug = slug;
    if (!postSlug) {
      postSlug = title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'post';
    }
    postSlug = postSlug.replace(/[^a-z0-9-]/g, '').toLowerCase();
    if (!postSlug) postSlug = 'post';

    // Check if we're updating an existing post (editing)
    const isNew = !existingSlug;
    const targetSlug = isNew ? postSlug : existingSlug;

    if (!isNew) {
      // Editing existing post — check ownership
      const existingPost = await store.get(`blog:post:${targetSlug}`, { type: 'json' });
      if (existingPost) {
        const isAdmin = auth.roles.includes('admin');
        const isOwner = existingPost.author === auth.email;
        if (!isAdmin && !isOwner) {
          return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'You can only edit your own posts.' }) };
        }
      }
    }

    // Build the post object
    const now = new Date().toISOString();
    let post = {};

    if (isNew) {
      post = {
        slug: postSlug,
        title: title.trim(),
        content: content || { blocks: [] },
        tags: tags || [],
        coverImage: coverImage || '',
        author: auth.email,
        status: status || 'draft',
        createdAt: now,
        updatedAt: now,
        publishedAt: status === 'published' ? now : null,
      };
    } else {
      const existingPost = await store.get(`blog:post:${targetSlug}`, { type: 'json' }) || {};
      post = {
        ...existingPost,
        title: title.trim(),
        content: content || existingPost.content || { blocks: [] },
        tags: tags || existingPost.tags || [],
        coverImage: coverImage !== undefined ? coverImage : existingPost.coverImage || '',
        updatedAt: now,
        status: status || existingPost.status || 'draft',
      };
      // Update publishedAt if transitioning to published
      if (status === 'published' && existingPost.status !== 'published') {
        post.publishedAt = now;
      }
      post.slug = existingSlug; // preserve original slug
    }

    // Save full post
    await store.setJSON(`blog:post:${post.slug}`, post);

    // Update the lightweight index
    const index = await store.get('blog:index', { type: 'json' }) || { posts: [] };

    // Build index entry (lightweight — no content)
    const indexEntry = {
      slug: post.slug,
      title: post.title,
      tags: post.tags,
      coverImage: post.coverImage,
      author: post.author,
      status: post.status,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      publishedAt: post.publishedAt,
      excerpt: extractExcerpt(post.content),
    };

    // Replace or append
    const existingIdx = index.posts.findIndex(p => p.slug === post.slug);
    if (existingIdx >= 0) {
      index.posts[existingIdx] = indexEntry;
    } else {
      index.posts.push(indexEntry);
    }

    await store.setJSON('blog:index', index);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        slug: post.slug,
        message: isNew ? 'Post created.' : 'Post updated.',
        post: { ...post, content: undefined }, // Don't return full content in response
      }),
    };
  } catch (err) {
    console.error('[blog-save] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error.' }),
    };
  }
};

function extractExcerpt(content) {
  if (!content || !content.blocks || !content.blocks.length) return '';
  // Find first paragraph block for excerpt
  for (const block of content.blocks) {
    if (block.type === 'paragraph' && block.data && block.data.text) {
      const text = block.data.text.replace(/<[^>]*>/g, '').trim();
      return text.length > 200 ? text.slice(0, 200) + '…' : text;
    }
    if (block.type === 'header' && block.data && block.data.text) {
      const text = block.data.text.replace(/<[^>]*>/g, '').trim();
      return text.length > 200 ? text.slice(0, 200) + '…' : text;
    }
  }
  return '';
}