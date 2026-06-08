// Netlify Function: GET /blog-render (invoked via redirect rule)
// Catches /blog/* requests that don't match a static file.
// Fetches the post from Blobs by slug, converts Editor.js JSON to HTML using editorjs-html.
const { getBlogStore } = require('./blog-store');
const editorjsHtml = require('editorjs-html');

const VALID_SLUG_RE = /^[a-z0-9-]+$/;

const HTML_HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>__TITLE__ — Vazhai Blog</title>
<meta name="description" content="__EXCERPT__">
<meta property="og:title" content="__TITLE__ — Vazhai Blog">
<meta property="og:description" content="__EXCERPT__">
<meta property="og:type" content="article">
__OG_IMAGE__
<link rel="canonical" href="__CANONICAL__">
<link rel="icon" type="image/x-icon" href="/images/favicon_io/favicon.ico">
<link rel="apple-touch-icon" href="/images/favicon_io/logo192x192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Lora:ital,wght@0,600;1,600&display=swap" rel="stylesheet">
<style>
:root {
  --amber: #E8920A; --amber-l: #FFF3DC; --amber-d: #B46800;
  --green: #2A6B2F; --green-l: #EAF5EB; --green-d: #1A4B1E;
  --red: #C0392B; --ink: #1A1A1A; --ink2: #444;
  --muted: #777; --border: #E2E2E2; --bg: #FFFFFF; --bg2: #F8F8F6;
  --dark: #1C1008; --sun: #F5C842; --nav-h: 64px; --bnav-h: 68px;
  --ff: 'Nunito', system-ui, sans-serif;
  --ff-serif: 'Lora', Georgia, serif;
}
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: var(--ff);
  background: var(--bg);
  color: var(--ink);
  overflow-x: hidden;
}
.top-bar {
  position:fixed; top:0; left:0; right:0; z-index:200;
  height:var(--nav-h); background:#fff;
  border-bottom:1.5px solid var(--border);
  display:flex; align-items:center;
  padding:0 16px; gap:12px;
  box-shadow:0 1px 8px rgba(0,0,0,.06);
}
.top-logo { width:40px; height:40px; border-radius:10px; background:#fff; border:1.5px solid var(--border); overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
.top-logo img { width:36px; height:36px; object-fit:contain; }
.top-brand { flex:1; }
.top-name { font-weight:900; font-size:1.05rem; color:var(--ink); letter-spacing:-.01em; line-height:1.1; }
.top-name span { color:var(--amber); }
.top-sub { font-size:.65rem; color:var(--muted); font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
.top-live { display:flex; align-items:center; gap:5px; font-size:.6rem; font-weight:700; color:var(--green); text-transform:uppercase; letter-spacing:.05em; background:var(--green-l); border-radius:100px; padding:4px 10px; flex-shrink:0; }
.live-dot { width:7px; height:7px; border-radius:50%; background:var(--green); animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.sidebar { display:none; }
main { padding-top:var(--nav-h); min-height:100vh; }
@media (min-width:768px) {
  :root { --nav-h:0px; --bnav-h:0px; --sb-w:220px; }
  .top-bar { display:none; }
  .sidebar {
    display:flex !important; flex-direction:column;
    position:fixed; left:0; top:0; bottom:0; width:var(--sb-w);
    background:var(--dark); padding:24px 0 20px; z-index:300; overflow-y:auto;
  }
  .sb-brand { padding:0 18px 20px; border-bottom:1px solid rgba(255,255,255,.1); margin-bottom:12px; display:flex; align-items:center; gap:12px; }
  .sb-logo { width:44px; height:44px; border-radius:10px; background:#fff; overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
  .sb-logo img { width:38px; height:38px; object-fit:contain; }
  .sb-name { font-weight:900; font-size:1.05rem; color:var(--sun); line-height:1.1; }
  .sb-tag { font-size:.58rem; color:rgba(255,255,255,.4); font-weight:600; text-transform:uppercase; letter-spacing:.06em; margin-top:2px; }
  .sb-nav { display:flex; flex-direction:column; flex:1; padding:0 10px; gap:3px; }
  .sb-item { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:10px; background:none; border:none; cursor:pointer; text-align:left; transition:background .15s; width:100%; -webkit-tap-highlight-color:transparent; text-decoration:none; }
  .sb-item:hover { background:rgba(255,255,255,.07); }
  .sb-item.active { background:rgba(232,146,10,.18); }
  .sb-item-icon { font-size:1.2rem; flex-shrink:0; }
  .sb-item-label { font-size:.72rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:rgba(255,255,255,.5); transition:color .15s; }
  .sb-item.active .sb-item-label, .sb-item:hover .sb-item-label { color:var(--sun); }
  .sb-footer { padding:14px 18px 0; border-top:1px solid rgba(255,255,255,.08); margin-top:auto; }
  .sb-footer-live { font-size:.58rem; color:var(--green); font-weight:700; text-transform:uppercase; letter-spacing:.06em; display:flex; align-items:center; gap:5px; margin-bottom:6px; }
  .sb-footer-reg { font-size:.52rem; color:rgba(255,255,255,.25); letter-spacing:.03em; line-height:1.7; }
  .sb-footer-links { margin-top:8px; font-size:.5rem; letter-spacing:.04em; }
  .sb-footer-links a { color:rgba(255,255,255,.35); text-decoration:none; transition:color .15s; }
  .sb-footer-links a:hover { color:var(--amber); text-decoration:underline; }
  .sb-donate-btn { display:flex; align-items:center; justify-content:center; gap:8px; margin:12px 10px 16px; background:var(--amber); color:#fff; border:none; border-radius:14px; padding:13px 16px; cursor:pointer; font-size:.72rem; font-weight:800; letter-spacing:.05em; text-transform:uppercase; transition:background .15s; text-decoration:none; }
  .sb-donate-btn:hover { background:var(--amber-d); }
  main { margin-left:var(--sb-w); width:calc(100% - var(--sb-w)); padding-top:0; }
}
/* Post content */
.post-container { max-width:760px; margin:0 auto; padding:24px 20px 60px; }
.post-header { margin-bottom:28px; }
.post-tags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
.post-tag { font-size:.6rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:4px 10px; border-radius:100px; background:var(--amber-l); color:var(--amber-d); }
.post-title { font-size:2rem; font-weight:900; line-height:1.15; color:var(--ink); margin-bottom:8px; }
.post-meta { font-size:.75rem; color:var(--muted); display:flex; gap:12px; flex-wrap:wrap; }
.post-meta span { display:flex; align-items:center; gap:4px; }
.post-cover { width:100%; border-radius:14px; margin-bottom:28px; overflow:hidden; }
.post-cover img { width:100%; height:auto; display:block; max-height:400px; object-fit:cover; }
/* Editor.js rendered blocks */
.editorjs h1, .editorjs h2, .editorjs h3, .editorjs h4 { font-weight:800; line-height:1.2; margin-top:1.8em; margin-bottom:.6em; color:var(--ink); }
.editorjs h1 { font-size:1.8rem; }
.editorjs h2 { font-size:1.5rem; }
.editorjs h3 { font-size:1.25rem; }
.editorjs p { font-size:1rem; line-height:1.75; color:var(--ink2); margin-bottom:1.2em; }
.editorjs ul, .editorjs ol { margin-bottom:1.2em; padding-left:1.5em; color:var(--ink2); line-height:1.75; }
.editorjs li { margin-bottom:.4em; }
.editorjs blockquote { border-left:4px solid var(--amber); padding:12px 18px; margin:1.5em 0; background:var(--amber-l); border-radius:0 10px 10px 0; font-style:italic; font-family:var(--ff-serif); color:var(--ink2); line-height:1.7; }
.editorjs blockquote p { margin-bottom:0; }
.editorjs img { max-width:100%; height:auto; border-radius:10px; margin:1.5em 0; display:block; }
.editorjs .codex-editor__redactor { padding-bottom:0 !important; }
.editorjs table { width:100%; border-collapse:collapse; margin:1.2em 0; font-size:.9rem; }
.editorjs table th, .editorjs table td { border:1px solid var(--border); padding:10px 12px; text-align:left; }
.editorjs table th { background:var(--bg2); font-weight:700; color:var(--ink); }
.editorjs table td { color:var(--ink2); }
.editorjs hr { border:none; border-top:2px solid var(--border); margin:2em 0; }
.editorjs .image-caption { font-size:.78rem; color:var(--muted); text-align:center; margin-top:-1em; margin-bottom:1.5em; }
.editorjs a { color:var(--amber-d); text-decoration:underline; }
.editorjs a:hover { color:var(--amber); }
/* Back link */
.back-link { display:inline-flex; align-items:center; gap:6px; color:var(--muted); text-decoration:none; font-size:.8rem; font-weight:600; margin-bottom:16px; transition:color .15s; }
.back-link:hover { color:var(--amber); }
.page-legal { display:flex; align-items:center; justify-content:center; gap:12px; padding:12px 16px; font-size:.48rem; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
.page-legal a { color:var(--muted); text-decoration:none; transition:color .15s; }
.page-legal a:hover { color:var(--amber); text-decoration:underline; }
@media (max-width:767px) {
  .post-title { font-size:1.5rem; }
  .post-container { padding:16px 16px 60px; }
}
</style>
</head>
<body>

<header class="top-bar">
  <div class="top-logo">
    <img src="/images/favicon_io/logo192x192.png" alt="Vazhai NGO" onerror="this.onerror=null;this.src='/images/vazahi-logo.gif'">
  </div>
  <div class="top-brand">
    <div class="top-name">வாழை <span>VAZHAI</span></div>
    <div class="top-sub">Rural Education · Tamil Nadu</div>
  </div>
  <div class="top-live"><div class="live-dot"></div>Blog</div>
</header>

<nav class="sidebar">
  <div class="sb-brand">
    <div class="sb-logo">
      <img src="/images/favicon_io/logo192x192.png" alt="Vazhai NGO" onerror="this.onerror=null;this.src='/images/vazahi-logo.gif'">
    </div>
    <div class="sb-brand-text">
      <div class="sb-name">வாழை VAZHAI</div>
      <div class="sb-tag">Rural Education NGO</div>
    </div>
  </div>
  <a href="/" class="sb-donate-btn">💛 Donate Now</a>
  <nav class="sb-nav">
    <a href="/" class="sb-item"><span class="sb-item-icon">🌿</span><span class="sb-item-label">Home</span></a>
    <a href="/who-we-are" class="sb-item"><span class="sb-item-icon">🌱</span><span class="sb-item-label">Who We Are</span></a>
    <a href="/what-we-do" class="sb-item"><span class="sb-item-icon">📚</span><span class="sb-item-label">What We Do</span></a>
    <a href="/blog" class="sb-item active"><span class="sb-item-icon">📝</span><span class="sb-item-label">Blog</span></a>
    <a href="/join" class="sb-item"><span class="sb-item-icon">🤝</span><span class="sb-item-label">Join Vazhai</span></a>
    <a href="/donate" class="sb-item"><span class="sb-item-icon">💛</span><span class="sb-item-label">Donate</span></a>
    <a href="/contact" class="sb-item"><span class="sb-item-icon">📬</span><span class="sb-item-label">Contact</span></a>
    <a href="/events" class="sb-item"><span class="sb-item-icon">📅</span><span class="sb-item-label">Events</span></a>
  </nav>
  <div class="sb-footer">
    <div class="sb-footer-live"><div class="live-dot"></div>Krishnagiri · Active 2025</div>
    <div class="sb-footer-reg">Est. April 2005 · Reg. No. 296/05<br>Tamil Nadu, India</div>
    <div class="sb-footer-links">
      <a href="/terms">Terms</a> · <a href="/privacy-policy">Privacy</a>
    </div>
  </div>
</nav>

<main>
  <div class="post-container">
    <a href="/blog" class="back-link">← Back to Blog</a>
    __POST_CONTENT__
  </div>
  <div class="page-legal">
    <a href="/terms">Terms</a> · <a href="/privacy-policy">Privacy</a>
  </div>
</main>

</body>
</html>`;

const HTML_ERROR = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Post Not Found — Vazhai Blog</title>
<link rel="icon" type="image/x-icon" href="/images/favicon_io/favicon.ico">
<link rel="apple-touch-icon" href="/images/favicon_io/logo192x192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
body { font-family: 'Nunito', sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding:20px; text-align:center; background:#f8f8f6; }
h1 { font-size:3rem; font-weight:900; color:#1A1A1A; margin-bottom:8px; }
p { font-size:1.1rem; color:#666; margin-bottom:24px; }
a { color:#E8920A; text-decoration:none; font-weight:700; }
a:hover { color:#B46800; }
</style>
</head>
<body>
<h1>404</h1>
<p>This post could not be found.</p>
<a href="/blog">← Back to Blog</a>
</body>
</html>`;

exports.handler = async function (event, context) {
  try {
    // Extract the slug from the path
    // The redirect rule sends /blog/some-post to this function
    // The original path is in event.path or we parse it ourselves
    const path = event.path || '';
    // Remove /blog/ prefix
    let slug = path.replace(/^\/blog\//, '').replace(/\/$/, '');
    
    // If no slug or just /blog, return the blog listing
    if (!slug || slug === 'blog' || slug === 'blog-render') {
      return {
        statusCode: 302,
        headers: { Location: '/blog/' },
        body: '',
      };
    }

    // Validate slug
    if (!VALID_SLUG_RE.test(slug)) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: HTML_ERROR,
      };
    }

    const store = await getBlogStore(event);
    const post = await store.get('blog:post:' + slug, { type: 'json' });

    if (!post || post.status !== 'published') {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: HTML_ERROR,
      };
    }

    // Convert Editor.js JSON to HTML
    const blocks = post.content && post.content.blocks ? post.content.blocks : [];
    let postHtml = '';

    if (blocks.length > 0) {
      try {
        const edJsParser = editorjsHtml();
        const htmlBlocks = edJsParser.parse(post.content);
        postHtml = htmlBlocks.join('\n');
      } catch (parseErr) {
        console.error('[blog-render] editorjs-html parse error:', parseErr.message);
        postHtml = '<p>Error rendering post content.</p>';
      }
    } else {
      postHtml = '<p>No content yet.</p>';
    }

    // Format the post header
    const tagsHtml = (post.tags || []).map(function(t) { return '<span class="post-tag">' + escapeHtml(t) + '</span>'; }).join('');
    const coverHtml = post.coverImage
      ? '<div class="post-cover"><img src="' + escapeHtml(post.coverImage) + '" alt="' + escapeHtml(post.title) + '" loading="lazy"></div>'
      : '';
    const date = post.publishedAt || post.createdAt;
    const dateStr = new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const postContent = `
      <div class="post-header">
        ${tagsHtml ? '<div class="post-tags">' + tagsHtml + '</div>' : ''}
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
        <div class="post-meta">
          <span>\uD83D\uDCC5 ${dateStr}</span>
          <span>\u270D\uFE0F ${escapeHtml(post.author)}</span>
        </div>
      </div>
      ${coverHtml}
      <div class="editorjs">
        ${postHtml}
      </div>
    `;

    // Build metadata for the HTML head
    const title = escapeHtml(post.title);
    const excerpt = extractExcerptForMeta(post);
    const escapedExcerpt = escapeHtml(excerpt);
    const canonical = 'https://vazhai.in/blog/' + slug;
    const ogImage = post.coverImage
      ? '<meta property="og:image" content="' + escapeHtml(post.coverImage) + '">\n    <meta name="twitter:card" content="summary_large_image">'
      : '<meta name="twitter:card" content="summary">';

    let fullHtml = HTML_HEAD
      .replace(/__TITLE__/g, title)
      .replace(/__EXCERPT__/g, escapedExcerpt)
      .replace(/__CANONICAL__/g, canonical)
      .replace(/__OG_IMAGE__/g, ogImage)
      .replace('__POST_CONTENT__', postContent);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: fullHtml,
    };
  } catch (err) {
    console.error('[blog-render] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: HTML_ERROR,
    };
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/[&]/g, '&' + 'amp;')
    .replace(/[<]/g, '&' + 'lt;')
    .replace(/[>]/g, '&' + 'gt;')
    .replace(/["]/g, '&' + 'quot;')
    .replace(/[']/g, '&#' + '039;');
}

function extractExcerptForMeta(post) {
  if (!post.content || !post.content.blocks) return '';
  for (var i = 0; i < post.content.blocks.length; i++) {
    var block = post.content.blocks[i];
    if (block.type === 'paragraph' && block.data && block.data.text) {
      return block.data.text.replace(/<[^>]*>/g, '').trim().slice(0, 200);
    }
    if (block.type === 'header' && block.data && block.data.text) {
      var text = block.data.text.replace(/<[^>]*>/g, '').trim();
      return text.length > 200 ? text.slice(0, 200) + '\u2026' : text;
    }
  }
  return '';
}