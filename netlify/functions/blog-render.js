// Netlify Function: GET /blog-render (invoked via redirect rule)
// Catches /blog/* and /ta/blog/* requests that don't match a static file.
// Fetches the post from Blobs by slug, converts Editor.js JSON to HTML using editorjs-html.
const { getBlogStore } = require('./blog-store');
const editorjsHtml = require('editorjs-html');

const VALID_SLUG_RE = /^[a-z0-9-]+$/;

function makeHead(lang, { title, excerpt, canonical, canonicalEn, canonicalTa, ogImage }) {
  const isTa = lang === 'ta';
  const pageTitle = isTa ? title + ' — வாழை வலைப்பதிவு' : title + ' — Vazhai Blog';
  const ogTitle = isTa ? title + ' — வாழை வலைப்பதிவு' : title + ' — Vazhai Blog';
  const langAttr = isTa ? 'ta' : 'en';
  const fontLink = isTa
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Lora:ital,wght@0,600;1,600&family=Noto+Sans+Tamil:wght@400;600;700;800&display=swap" rel="stylesheet">`
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Lora:ital,wght@0,600;1,600&display=swap" rel="stylesheet">`;

  return `<!DOCTYPE html>
<html lang="${langAttr}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${excerpt}">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${excerpt}">
<meta property="og:type" content="article">
${ogImage}
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en" href="${canonicalEn}">
<link rel="alternate" hreflang="ta" href="${canonicalTa}">
<link rel="icon" type="image/x-icon" href="/images/favicon_io/favicon.ico">
<link rel="apple-touch-icon" href="/images/favicon_io/logo192x192.png">
${fontLink}
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
/* Comments section */
.comments-section { margin-top:48px; padding-top:32px; border-top:2px solid var(--border); }
.comments-heading { font-size:1.3rem; font-weight:800; margin-bottom:6px; color:var(--ink); }
.comments-sub { font-size:.8rem; color:var(--muted); margin-bottom:24px; }
.comment { padding:16px 0; border-bottom:1px solid var(--border); }
.comment:last-child { border-bottom:none; }
.comment-meta { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
.comment-avatar { width:32px; height:32px; border-radius:50%; background:var(--amber-l); color:var(--amber-d); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.8rem; flex-shrink:0; }
.comment-author { font-weight:700; font-size:.85rem; color:var(--ink); }
.comment-date { font-size:.7rem; color:var(--muted); }
.comment-text { font-size:.95rem; line-height:1.6; color:var(--ink2); margin-left:40px; word-wrap:break-word; }
.comment-form { margin-top:24px; }
.comment-form textarea { width:100%; padding:12px 16px; border:2px solid var(--border); border-radius:10px; font-family:var(--ff); font-size:.95rem; resize:vertical; min-height:90px; outline:none; transition:border-color .15s; }
.comment-form textarea:focus { border-color:var(--amber); }
.comment-form .cf-footer { display:flex; align-items:center; justify-content:space-between; margin-top:10px; gap:10px; }
.comment-form .cf-btn { background:var(--amber); color:#fff; border:none; border-radius:10px; padding:10px 24px; font-weight:700; font-size:.85rem; cursor:pointer; transition:background .15s; font-family:var(--ff); }
.comment-form .cf-btn:hover { background:var(--amber-d); }
.comment-form .cf-btn:disabled { background:#ccc; cursor:not-allowed; }
.comment-form .cf-login-msg { font-size:.8rem; color:var(--muted); }
.comment-form .cf-login-msg a { color:var(--amber-d); font-weight:700; text-decoration:none; }
.comment-form .cf-login-msg a:hover { text-decoration:underline; }
.comment-form .cf-error { font-size:.8rem; color:var(--red); margin-top:6px; display:none; }
.comment-spinner { display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:spin .6s linear infinite; vertical-align:middle; margin-right:6px; }
@keyframes spin { to { transform:rotate(360deg); } }
.comments-empty { font-size:.9rem; color:var(--muted); padding:12px 0; }
/* Comment approval styles */
.comment.approved { opacity:1; }
.comment.pending { opacity:0.85; background:#fff8e1; border-left:3px solid #ffa000; border-radius:0 8px 8px 0; padding-left:8px; }
.comment .approve-comment-btn { display:inline-block; padding:3px 10px; font-size:11px; font-weight:700; color:#fff; background:var(--green); border:none; border-radius:4px; cursor:pointer; font-family:var(--ff); margin:6px 0 0 40px; }
.comment .approve-comment-btn:hover { background:var(--green-d); }
.pending-label { font-size:11px; color:#ffa000; font-weight:700; margin-left:8px; text-transform:uppercase; letter-spacing:.03em; }
.edited-label { font-size:11px; color:var(--muted); font-weight:600; font-style:italic; }
.comment .edit-comment-btn { display:inline-block; padding:3px 10px; font-size:11px; font-weight:700; color:var(--amber-d); background:var(--amber-l); border:1px solid var(--amber); border-radius:4px; cursor:pointer; font-family:var(--ff); }
.comment .edit-comment-btn:hover { background:var(--amber); color:#fff; }
/* Edit link in post-meta */
.post-meta .post-edit-link { display:inline-flex; align-items:center; gap:2px; color:var(--muted); text-decoration:none; transition:color .15s; }
.post-meta .post-edit-link:hover { color:var(--green); }
.page-legal { display:flex; align-items:center; justify-content:center; gap:12px; padding:12px 16px; font-size:.48rem; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
.page-legal a { color:var(--muted); text-decoration:none; transition:color .15s; }
.page-legal a:hover { color:var(--amber); text-decoration:underline; }
@media (max-width:767px) {
  .post-title { font-size:1.5rem; }
  .post-container { padding:16px 16px 60px; }
}
</style>
</head>
<body>`;
}

const HTML_EN_BODY = `__EN_LANG_SWITCHER__
<header class="top-bar">
  <div class="top-logo">
    <img src="/images/favicon_io/logo192x192.png" alt="Vazhai NGO" onerror="this.onerror=null;this.src='/images/vazahi-logo.gif'">
  </div>
  <div class="top-brand">
    <div class="top-name">வாழை <span>VAZHAI</span></div>
    <div class="top-sub">Rural Education · Tamil Nadu</div>
  </div>
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

const HTML_TA_BODY = `__TA_LANG_SWITCHER__
<header class="top-bar">
  <div class="top-logo">
    <img src="/images/favicon_io/logo192x192.png" alt="வாழை அறக்கட்டளை" onerror="this.onerror=null;this.src='/images/vazahi-logo.gif'">
  </div>
  <div class="top-brand">
    <div class="top-name">வாழை <span>VAZHAI</span></div>
    <div class="top-sub">கிராமியக் கல்வி · தமிழ்நாடு</div>
  </div>
</header>

<nav class="sidebar">
  <div class="sb-brand">
    <div class="sb-logo">
      <img src="/images/favicon_io/logo192x192.png" alt="வாழை அறக்கட்டளை" onerror="this.onerror=null;this.src='/images/vazahi-logo.gif'">
    </div>
    <div class="sb-brand-text">
      <div class="sb-name">வாழை VAZHAI</div>
      <div class="sb-tag">கிராமப்புற கல்வித் தொண்டு நிறுவனம்</div>
    </div>
  </div>
  <a href="/ta/" class="sb-donate-btn">💛 நன்கொடை</a>
  <nav class="sb-nav">
    <a href="/ta/" class="sb-item"><span class="sb-item-icon">🌿</span><span class="sb-item-label">முகப்பு</span></a>
    <a href="/ta/who-we-are" class="sb-item"><span class="sb-item-icon">🌱</span><span class="sb-item-label">நாங்கள் யார்</span></a>
    <a href="/ta/what-we-do" class="sb-item"><span class="sb-item-icon">📚</span><span class="sb-item-label">நாங்கள் செய்வது</span></a>
    <a href="/ta/blog" class="sb-item active"><span class="sb-item-icon">📝</span><span class="sb-item-label">வலைப்பதிவு</span></a>
    <a href="/ta/join" class="sb-item"><span class="sb-item-icon">🤝</span><span class="sb-item-label">வாழையில் சேர</span></a>
    <a href="/ta/donate" class="sb-item"><span class="sb-item-icon">💛</span><span class="sb-item-label">நன்கொடை</span></a>
    <a href="/ta/contact" class="sb-item"><span class="sb-item-icon">📬</span><span class="sb-item-label">தொடர்பு</span></a>
    <a href="/ta/events" class="sb-item"><span class="sb-item-icon">📅</span><span class="sb-item-label">நிகழ்வுகள்</span></a>
  </nav>
  <div class="sb-footer">
    <div class="sb-footer-live"><div class="live-dot"></div>கிருஷ்ணகிரி · 2025 செயலில்</div>
    <div class="sb-footer-reg">ஏப். 2005 நிறுவப்பட்டது · பதிவு எண். 296/05<br>தமிழ்நாடு, இந்தியா</div>
    <div class="sb-footer-links">
      <a href="/ta/terms">விதிமுறைகள்</a> · <a href="/ta/privacy-policy">தனியுரிமை</a>
    </div>
  </div>
</nav>

<main>
  <div class="post-container">
    <a href="/ta/blog" class="back-link">← வலைப்பதிவுக்குத் திரும்பு</a>
    __POST_CONTENT__
  </div>
  <div class="page-legal">
    <a href="/ta/terms">விதிமுறைகள்</a> · <a href="/ta/privacy-policy">தனியுரிமை</a>
  </div>
</main>
</body>
</html>`;

const HTML_ERROR_EN = `<!DOCTYPE html>
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

const HTML_ERROR_TA = `<!DOCTYPE html>
<html lang="ta">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>பதிவு கிடைக்கவில்லை — வாழை வலைப்பதிவு</title>
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
<p>இந்தப் பதிவு கிடைக்கவில்லை.</p>
<a href="/ta/blog">← வலைப்பதிவுக்குத் திரும்பு</a>
</body>
</html>`;

exports.handler = async function (event, context) {
  try {
    const path = event.path || '';
    // Detect if this is a Tamil request (/ta/blog/...)
    const isTamil = path.startsWith('/ta/blog/');
    // Remove /blog/ or /ta/blog/ prefix to get slug
    let slug = path.replace(/^\/ta\/blog\//, '').replace(/^\/blog\//, '').replace(/\/$/, '');

    // If no slug, redirect to the appropriate blog listing
    if (!slug || slug === 'blog' || slug === 'blog-render' || slug === 'ta/blog') {
      return {
        statusCode: 302,
        headers: { Location: isTamil ? '/ta/blog/' : '/blog/' },
        body: '',
      };
    }

    // Validate slug
    if (!VALID_SLUG_RE.test(slug)) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: isTamil ? HTML_ERROR_TA : HTML_ERROR_EN,
      };
    }

    const store = await getBlogStore(event);
    const post = await store.get('blog:post:' + slug, { type: 'json' });

    if (!post) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: isTamil ? HTML_ERROR_TA : HTML_ERROR_EN,
      };
    }

    // Published posts are public. Non-published (draft, pending) require admin or author.
    if (post.status !== 'published') {
      const authStore = require('./auth-store').getStore;
      const { getSession, getUserRoles } = require('./blog-auth');
      const aStore = await authStore(event);
      const session = await getSession(aStore, event);
      let canView = false;
      if (session) {
        const roles = await getUserRoles(aStore, session.email);
        const isAdmin = roles.includes('admin');
        const isAuthor = post.author === session.email;
        canView = isAdmin || isAuthor;
      }
      if (!canView) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: isTamil ? HTML_ERROR_TA : HTML_ERROR_EN,
        };
      }
    }

    // Look up author display name from user store
    let authorDisplayName = post.author;
    try {
      const authStore = require('./auth-store').getStore;
      const aStore = await authStore(event);
      const authorData = await aStore.get(`user:${post.author}`, { type: 'json' });
      if (authorData && authorData.name) {
        authorDisplayName = authorData.name;
      }
    } catch (e) {
      console.warn('[blog-render] Could not fetch author name, falling back to email');
    }

    // Convert Editor.js JSON to HTML
    const blocks = post.content && post.content.blocks ? post.content.blocks : [];
    let postHtml = '';

    if (blocks.length > 0) {
      try {
        const edJsParser = editorjsHtml();
        postHtml = edJsParser.parse(post.content);
      } catch (parseErr) {
        console.error('[blog-render] editorjs-html parse error:', parseErr.message);
        postHtml = isTamil ? '<p>உள்ளடக்கத்தை வழங்குவதில் பிழை.</p>' : '<p>Error rendering post content.</p>';
      }
    } else {
      postHtml = isTamil ? '<p>இதுவரை உள்ளடக்கம் இல்லை.</p>' : '<p>No content yet.</p>';
    }

    // Format the post header
    const tagsHtml = (post.tags || []).map(function(t) { return '<span class="post-tag">' + escapeHtml(t) + '</span>'; }).join('');
    const coverHtml = post.coverImage
      ? '<div class="post-cover"><img src="' + escapeHtml(post.coverImage) + '" alt="' + escapeHtml(post.title) + '" loading="lazy"></div>'
      : '';
    const date = post.publishedAt || post.createdAt;
    const dateLocale = isTamil ? 'ta-IN' : 'en-IN';
    const dateStr = new Date(date).toLocaleDateString(dateLocale, {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    // Language-specific labels
    const commentsHeading = isTamil ? '💬 கருத்துகள்' : '💬 Comments';
    const commentsSub = isTamil ? 'உரையாடலில் சேரவும்' : 'Join the conversation';
    const commentPlaceholder = isTamil ? 'கருத்தை எழுதுங்கள்...' : 'Write a comment...';
    const postCommentLabel = isTamil ? 'கருத்தைப் பதிவிடு' : 'Post Comment';
    const loginToComment = isTamil ? 'கருத்து சொல்ல ' : ' to comment';
    const loginText = isTamil ? 'உள்நுழைக' : 'Log in';
    const editLabel = isTamil ? 'தொகு' : 'Edit';
    const noComments = isTamil ? 'இதுவரை கருத்துகள் இல்லை. முதலில் கருத்து சொல்லுங்கள்!' : 'No comments yet. Be the first!';
    const pendingApproval = isTamil ? '⏳ ஒப்புதல் நிலுவையில்' : '⏳ Pending Approval';
    const approvedComments = isTamil ? 'ஒப்புதல் பெற்ற கருத்துகள்' : 'Approved Comments';
    const commentsLabel = isTamil ? 'கருத்துகள்' : 'Comments';
    const pendingLabel = isTamil ? 'நிலுவை' : 'Pending';
    const approveLabel = isTamil ? '✓ ஒப்புதல்' : '✓ Approve';
    const saveLabel = isTamil ? 'சேமி' : 'Save';
    const cancelLabel = isTamil ? 'ரத்துசெய்' : 'Cancel';
    const editCommentLabel = isTamil ? '✏️ தொகு' : '✏️ Edit';
    const pleaseWrite = isTamil ? 'தயவுசெய்து கருத்தை எழுதுங்கள்.' : 'Please write a comment.';
    const tooLong = isTamil ? 'கருத்து மிக நீளமாக உள்ளது (அதிகபட்சம் 2000 எழுத்துகள்).' : 'Comment is too long (max 2000 characters).';
    const posting = isTamil ? 'இடுகையிடுகிறது...' : 'Posting...';
    const commentSubmitted = isTamil ? '✅ கருத்து சமர்ப்பிக்கப்பட்டது! பதிவின் ஆசிரியர் அல்லது நிர்வாகியால் ஒப்புதல் அளிக்கப்பட்டதும் தோன்றும்.' : '✅ Comment submitted! It will appear once approved by the post author or admin.';
    const failedComment = isTamil ? 'கருத்தை இடுகையிட முடியவில்லை.' : 'Failed to post comment.';
    const networkError = isTamil ? 'நெட்வொர்க் பிழை. மீண்டும் முயற்சிக்கவும்.' : 'Network error. Please try again.';
    const editedLabel = isTamil ? ' (திருத்தப்பட்டது)' : ' (edited)';
    const couldNotLoad = isTamil ? 'கருத்துகளை ஏற்ற முடியவில்லை.' : 'Could not load comments.';
    const approveError = isTamil ? 'கருத்தை ஒப்புதல் அளிக்க முடியவில்லை.' : 'Failed to approve comment.';
    const editError = isTamil ? 'கருத்தை திருத்த முடியவில்லை.' : 'Failed to edit comment.';
    const emptyError = isTamil ? 'கருத்து காலியாக இருக்க முடியாது.' : 'Comment cannot be empty.';

    const postContent = `
      <div class="post-header">
        ${tagsHtml ? '<div class="post-tags">' + tagsHtml + '</div>' : ''}
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
        <div class="post-meta">
          <span>\uD83D\uDCC5 ${dateStr}</span>
          <span>\u270D\uFE0F ${escapeHtml(authorDisplayName)}</span>
          <span id="post-edit-link" style="display:none;"><a href="/dashboard/blog-editor?edit=${escapeHtml(slug)}" class="post-edit-link">\u270F\uFE0F ${editLabel}</a></span>
        </div>
      </div>
      ${coverHtml}
      <div class="editorjs">
        ${postHtml}
      </div>
      <script>
        var __postAuthor = ${JSON.stringify(post.author)};
        (async function() {
          try {
            var t = localStorage.getItem('vazhai_session');
            var h = { 'Content-Type': 'application/json' };
            if (t) h['Authorization'] = 'Bearer ' + t;
            var r = await fetch('/auth/check', { headers: h });
            var d = await r.json();
            if (d.authenticated && d.email === __postAuthor) {
              document.getElementById('post-edit-link').style.display = '';
            }
          } catch(e) {}
        })();
      <\/script>
      <div class="comments-section" id="comments-section">
        <h2 class="comments-heading">${commentsHeading}</h2>
        <div class="comments-sub">${commentsSub}</div>
        <div id="comments-list" class="comments-list"></div>
        <div class="comment-form" id="comment-form">
          <textarea id="comment-input" placeholder="${commentPlaceholder}" maxlength="2000"></textarea>
          <div class="cf-footer">
            <button class="cf-btn" id="comment-submit-btn" onclick="submitComment()">${postCommentLabel}</button>
            <div class="cf-login-msg" id="comment-login-msg">
              <a href="${isTamil ? '/ta/login?redirect=/ta/blog/' : '/login?redirect=/blog/'}${escapeHtml(slug)}">${loginText}</a>${loginToComment}
            </div>
          </div>
          <div class="cf-error" id="comment-error"></div>
        </div>
      </div>
      <script>
        (function() {
          var slug = ${JSON.stringify(slug)};
          var listEl = document.getElementById('comments-list');
          var formEl = document.getElementById('comment-form');
          var loginMsg = document.getElementById('comment-login-msg');
          var submitBtn = document.getElementById('comment-submit-btn');
          var inputEl = document.getElementById('comment-input');
          var errorEl = document.getElementById('comment-error');
          var postAuthor = ${JSON.stringify(post.author)};
          var canApprove = false;
          var currentUserEmail = null;
          var token = localStorage.getItem('vazhai_session');

          function doApprove(commentId) {
            var t = localStorage.getItem('vazhai_session');
            var hdrs = { 'Content-Type': 'application/json' };
            if (t) hdrs['Authorization'] = 'Bearer ' + t;
            fetch('/blog/comment/approve', {
              method: 'POST',
              headers: hdrs,
              body: JSON.stringify({ slug: slug, commentId: commentId }),
            })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.success) { loadComments(); }
                else { alert(data.error || '${approveError}'); }
              })
              .catch(function() { alert('${networkError}'); });
          }

          function doEditComment(commentId, newText) {
            var t = localStorage.getItem('vazhai_session');
            var hdrs = { 'Content-Type': 'application/json' };
            if (t) hdrs['Authorization'] = 'Bearer ' + t;
            fetch('/blog/comment/edit', {
              method: 'POST',
              headers: hdrs,
              body: JSON.stringify({ slug: slug, commentId: commentId, text: newText }),
            })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.success) { loadComments(); }
                else { alert(data.error || '${editError}'); }
              })
              .catch(function() { alert('${networkError}'); });
          }

          document.getElementById('comments-list').addEventListener('click', function(e) {
            var btn = e.target.closest('.approve-comment-btn');
            if (btn) { doApprove(btn.getAttribute('data-comment-id')); return; }
            var editBtn = e.target.closest('.edit-comment-btn');
            if (editBtn) {
              var commentId = editBtn.getAttribute('data-comment-id');
              var textEl = document.getElementById('comment-text-' + escHtmlAttr(commentId));
              var actionsEl = document.getElementById('comment-actions-' + escHtmlAttr(commentId));
              var editContainer = document.getElementById('comment-edit-' + escHtmlAttr(commentId));
              if (textEl && actionsEl && editContainer) {
                textEl.style.display = 'none';
                actionsEl.style.display = 'none';
                editContainer.style.display = 'block';
                editContainer.querySelector('textarea').focus();
              }
            }
            var saveBtn = e.target.closest('.edit-save-btn');
            if (saveBtn) {
              var commentId = saveBtn.getAttribute('data-comment-id');
              var editContainer = document.getElementById('comment-edit-' + escHtmlAttr(commentId));
              var textarea = editContainer.querySelector('textarea');
              var newText = textarea.value.trim();
              if (!newText) { alert('${emptyError}'); return; }
              if (newText.length > 2000) { alert('${tooLong}'); return; }
              doEditComment(commentId, newText);
            }
            var cancelBtn = e.target.closest('.edit-cancel-btn');
            if (cancelBtn) {
              var commentId = cancelBtn.getAttribute('data-comment-id');
              var textEl = document.getElementById('comment-text-' + escHtmlAttr(commentId));
              var actionsEl = document.getElementById('comment-actions-' + escHtmlAttr(commentId));
              var editContainer = document.getElementById('comment-edit-' + escHtmlAttr(commentId));
              if (textEl && actionsEl && editContainer) {
                textEl.style.display = '';
                actionsEl.style.display = '';
                editContainer.style.display = 'none';
                editContainer.querySelector('textarea').value = textEl.getAttribute('data-original-text') || '';
              }
            }
          });

          function canEditComment(c) {
            if (!currentUserEmail) return false;
            return c.email === currentUserEmail || canApprove;
          }

          function buildCommentEl(c, isPending) {
            var d = new Date(c.createdAt);
            var ds = d.toLocaleDateString('${isTamil ? 'ta-IN' : 'en-IN'}', { year:'numeric', month:'short', day:'numeric' });
            var initial = (c.name || '?')[0].toUpperCase();
            var el = document.createElement('div');
            el.className = 'comment ' + (isPending ? 'pending' : 'approved');
            el.id = 'comment-el-' + escHtmlAttr(c.id);
            var editable = canEditComment(c);
            var editedLabelHtml = c.editedAt ? ' <span class="edited-label">${editedLabel}</span>' : '';
            var approveBtnHtml = isPending && canApprove
              ? '<button class="approve-comment-btn" data-comment-id="' + escHtmlAttr(c.id) + '">${approveLabel}</button>'
              : '';
            var editBtnHtml = editable
              ? '<button class="edit-comment-btn" data-comment-id="' + escHtmlAttr(c.id) + '">${editCommentLabel}</button>'
              : '';
            var pendLabel = isPending ? '<span class="pending-label">${pendingLabel}</span>' : '';
            el.innerHTML =
              '<div class="comment-meta">' +
                '<div class="comment-avatar">' + initial + '</div>' +
                '<span class="comment-author">' + escHtml(c.name) + '</span>' +
                '<span class="comment-date">' + ds + '</span>' +
                editedLabelHtml +
                pendLabel +
              '</div>' +
              '<div class="comment-text" id="comment-text-' + escHtmlAttr(c.id) + '" data-original-text="' + escHtmlAttr(c.text) + '">' + escHtml(c.text) + '</div>' +
              '<div class="comment-actions" id="comment-actions-' + escHtmlAttr(c.id) + '" style="margin:4px 0 0 40px;display:flex;gap:8px;">' +
                approveBtnHtml +
                editBtnHtml +
              '</div>' +
              '<div class="comment-edit" id="comment-edit-' + escHtmlAttr(c.id) + '" style="display:none;margin:4px 0 0 40px;">' +
                '<textarea style="width:100%;padding:8px 12px;border:2px solid var(--border);border-radius:8px;font-family:var(--ff);font-size:.9rem;resize:vertical;min-height:60px;outline:none;" maxlength="2000">' + escHtml(c.text) + '</textarea>' +
                '<div style="margin-top:6px;display:flex;gap:8px;">' +
                  '<button class="edit-save-btn" data-comment-id="' + escHtmlAttr(c.id) + '" style="padding:5px 16px;font-size:.8rem;font-weight:700;color:#fff;background:var(--green);border:none;border-radius:6px;cursor:pointer;font-family:var(--ff);">${saveLabel}</button>' +
                  '<button class="edit-cancel-btn" data-comment-id="' + escHtmlAttr(c.id) + '" style="padding:5px 16px;font-size:.8rem;font-weight:600;color:var(--ink2);background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-family:var(--ff);">${cancelLabel}</button>' +
                '</div>' +
              '</div>';
            return el;
          }

          function loadComments() {
            fetch('/blog/comment?slug=' + encodeURIComponent(slug))
              .then(function(r) { return r.json(); })
              .then(function(data) {
                var allComments = data.comments || [];
                var approved = [];
                var pending = [];
                allComments.forEach(function(c) {
                  if (c.approved) { approved.push(c); }
                  else if (canApprove || c.email === currentUserEmail) { pending.push(c); }
                });
                if (approved.length === 0 && pending.length === 0) {
                  listEl.innerHTML = '<div class="comments-empty">${noComments}</div>';
                  return;
                }
                listEl.innerHTML = '';
                if (pending.length > 0) {
                  var pendHead = document.createElement('div');
                  pendHead.className = 'comments-sub';
                  pendHead.style.marginTop = '16px';
                  pendHead.textContent = '${pendingApproval} (' + pending.length + ')';
                  listEl.appendChild(pendHead);
                  pending.forEach(function(c) { listEl.appendChild(buildCommentEl(c, true)); });
                }
                if (approved.length > 0) {
                  var apprHead = document.createElement('div');
                  apprHead.className = 'comments-sub';
                  apprHead.style.marginTop = '16px';
                  apprHead.textContent = '\uD83D\uDCAC ' + (pending.length > 0 ? '${approvedComments}' : '${commentsLabel}') + ' (' + approved.length + ')';
                  listEl.appendChild(apprHead);
                  approved.forEach(function(c) { listEl.appendChild(buildCommentEl(c, false)); });
                }
              })
              .catch(function() { listEl.innerHTML = '<div class="comments-empty">${couldNotLoad}</div>'; });
          }

          if (token) {
            var h = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
            fetch('/auth/check', { headers: h })
              .then(function(r) { return r.json(); })
              .then(function(d) {
                if (d.authenticated) {
                  currentUserEmail = d.email;
                  canApprove = (d.email === postAuthor) || (d.roles && d.roles.indexOf('admin') !== -1);
                  loginMsg.style.display = 'none';
                  submitBtn.style.display = '';
                  loadComments();
                } else { loginMsg.style.display = ''; submitBtn.style.display = 'none'; loadComments(); }
              })
              .catch(function() { loadComments(); });
          } else { loginMsg.style.display = ''; submitBtn.style.display = 'none'; loadComments(); }

          window.submitComment = function() {
            var text = inputEl.value.trim();
            if (!text) { errorEl.textContent = '${pleaseWrite}'; errorEl.style.display = 'block'; return; }
            if (text.length > 2000) { errorEl.textContent = '${tooLong}'; errorEl.style.display = 'block'; return; }
            errorEl.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="comment-spinner"></span>${posting}';
            var t = localStorage.getItem('vazhai_session');
            var headers = { 'Content-Type': 'application/json' };
            if (t) headers['Authorization'] = 'Bearer ' + t;
            fetch('/blog/comment', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({ slug: slug, text: text }),
            })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.ok && data.comment) {
                  inputEl.value = '';
                  loadComments();
                  if (!data.approved) {
                    errorEl.style.color = '#ffa000';
                    errorEl.textContent = '${commentSubmitted}';
                    errorEl.style.display = 'block';
                    setTimeout(function() { errorEl.style.display = 'none'; }, 5000);
                  }
                } else { errorEl.style.color = '#C0392B'; errorEl.textContent = data.error || '${failedComment}'; errorEl.style.display = 'block'; }
              })
              .catch(function() { errorEl.style.color = '#C0392B'; errorEl.textContent = '${networkError}'; errorEl.style.display = 'block'; })
              .finally(function() { submitBtn.disabled = false; submitBtn.innerHTML = '${postCommentLabel}'; });
          };

          function escHtml(str) {
            if (!str) return '';
            return String(str).replace(/[&]/g, '&' + 'amp;').replace(/[<]/g, '&' + 'lt;').replace(/[>]/g, '&' + 'gt;').replace(/["]/g, '&' + 'quot;').replace(/[']/g, '&#' + '039;');
          }

          function escHtmlAttr(str) {
            if (!str) return '';
            return String(str).replace(/[&]/g, '&' + 'amp;').replace(/["]/g, '&' + 'quot;').replace(/[']/g, '&#' + '039;').replace(/[<]/g, '&' + 'lt;').replace(/[>]/g, '&' + 'gt;');
          }
        })();
      <\/script>
    `;

    // Build metadata
    const title = escapeHtml(post.title);
    const excerpt = extractExcerptForMeta(post);
    const escapedExcerpt = escapeHtml(excerpt);
    const canonicalEn = 'https://vazhai.in/blog/' + slug;
    const canonicalTa = 'https://vazhai.in/ta/blog/' + slug;
    const canonical = isTamil ? canonicalTa : canonicalEn;
    const ogImage = post.coverImage
      ? '<meta property="og:image" content="' + escapeHtml(post.coverImage) + '">\n    <meta name="twitter:card" content="summary_large_image">'
      : '<meta name="twitter:card" content="summary">';

    // Build lang switcher HTML
    const langSwitcherEn = `<nav class="lang-switcher" aria-label="Language Switcher">
  <a href="/blog/${slug}" class="lang-link active" data-lang="en">English</a>
  <span class="lang-sep">|</span>
  <a href="/ta/blog/${slug}" class="lang-link" data-lang="ta">தமிழ்</a>
</nav>`;

    const langSwitcherTa = `<nav class="lang-switcher" aria-label="மொழி மாற்றி">
  <a href="/blog/${slug}" class="lang-link" data-lang="en">English</a>
  <span class="lang-sep">|</span>
  <a href="/ta/blog/${slug}" class="lang-link active" data-lang="ta">தமிழ்</a>
</nav>`;

    // Build the full HTML
    const headHtml = makeHead(isTamil ? 'ta' : 'en', {
      title,
      excerpt: escapedExcerpt,
      canonical,
      canonicalEn,
      canonicalTa,
      ogImage,
    });

    let bodyHtml = isTamil
      ? HTML_TA_BODY.replace('__TA_LANG_SWITCHER__', langSwitcherTa).replace('__POST_CONTENT__', postContent)
      : HTML_EN_BODY.replace('__EN_LANG_SWITCHER__', langSwitcherEn).replace('__POST_CONTENT__', postContent);

    const fullHtml = headHtml + bodyHtml;

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
      body: HTML_ERROR_EN,
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