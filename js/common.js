/* ═══════════════════════════════════════════════════
   COMMON — shared across all pages
   SEO navigation, accordion, carousel, dynamic years, copy link
═══════════════════════════════════════════════════ */

/* ── SEO META ── */
const sectionMeta = {
  'home':        { title:'Vazhai NGO — Rural Education NGO Tamil Nadu | Krishnagiri, Dharmapuri, Villupuram', description:'Vazhai is an impact-focused education NGO placing full-time School Companions in rural government schools across Tamil Nadu. Donate, volunteer, or sponsor a school.' },
  'who-we-are':  { title:'Who We Are — Vazhai NGO | Rural Education Tamil Nadu Since 2005', description:'Founded in April 2005 by first-generation graduates from Presidency College Chennai, Vazhai has supported 500+ students across Tamil Nadu.' },
  'what-we-do':  { title:'What We Do — School Companions & Field Coordinators | Vazhai NGO', description:'Vazhai places full-time School Companions and Field Coordinators in remote government schools in Krishnagiri, Tamil Nadu. We target 10 schools by 2026.' },
  'join-vazhai': { title:'Join Vazhai — Volunteer, School Companion or Field Coordinator | Tamil Nadu NGO', description:'Volunteer remotely with Vazhai NGO, or apply for a full-time School Companion or Field Coordinator role in Krishnagiri, Tamil Nadu.' },
  'donation':   { title:'Donate to Vazhai NGO — Support Rural Education in Tamil Nadu', description:'₹15,000/month fully funds a School Companion in a rural Tamil Nadu government school. Support Vazhai NGO with a one-time or monthly donation.' },
  'contact-us': { title:'Contact Vazhai NGO — Rural Education, Tamil Nadu | Email & Address', description:'Contact Vazhai NGO to volunteer, donate, explore CSR education projects in Tamil Nadu, or visit schools in Krishnagiri.' },
  'vazhai-events': { title:'Vazhai Events — Field Events & Online Calls | Rural Education NGO Tamil Nadu', description:"Join Vazhai NGO's weekly Friday volunteer calls, field events in Krishnagiri, career guidance sessions, and student assessments across Tamil Nadu." }
};

const canonicalBase = 'https://vazhai.in';
const sectionPaths = {
  'home':        '/',
  'who-we-are':  '/who-we-are.html',
  'what-we-do':  '/what-we-do.html',
  'join-vazhai': '/join-vazhai.html',
  'donation':   '/donate.html',
  'contact-us': '/contact.html',
  'vazhai-events': '/events.html'
};

/* ── Accordion (mobile only) ── */
function toggleProg(card) {
  if (window.innerWidth >= 720) return;
  const isOpen = card.classList.contains('open');
  document.querySelectorAll('.prog-card').forEach(c => {
    c.classList.remove('open');
    c.setAttribute('aria-expanded', 'false');
  });
  if (!isOpen) {
    card.classList.add('open');
    card.setAttribute('aria-expanded', 'true');
  }
}

/* ── Carousel arrow navigation ── */
function scrollCarousel(btn, dir) {
  const wrap = btn.closest('[data-scroll-wrap]');
  const scroller = wrap.querySelector('.hscroll');
  if (!scroller) return;
  const items = scroller.querySelectorAll('*');
  if (!items.length) return;
  const gap = 12;
  const itemW = items[0].offsetWidth + gap;
  const maxScroll = scroller.scrollWidth - scroller.clientWidth;
  let target = scroller.scrollLeft + dir * itemW;
  if (target < 0) target = 0;
  if (target > maxScroll) target = maxScroll;
  scroller.scrollTo({ left: target, behavior: 'smooth' });
}

function updateArrows(scroller) {
  const wrap = scroller.closest('[data-scroll-wrap]');
  if (!wrap) return;
  const leftBtn = wrap.querySelector('.scroll-arrow-left');
  const rightBtn = wrap.querySelector('.scroll-arrow-right');
  const atStart = scroller.scrollLeft <= 8;
  const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 8;
  if (leftBtn) leftBtn.classList.toggle('visible', !atStart);
  if (rightBtn) rightBtn.classList.toggle('visible', !atEnd);
}

function initCarousels() {
  document.querySelectorAll('.hscroll').forEach(scroller => {
    updateArrows(scroller);
    scroller.addEventListener('scroll', () => updateArrows(scroller), { passive: true });
  });
}

document.addEventListener('DOMContentLoaded', initCarousels);
setTimeout(initCarousels, 400);

/* ── Dynamic years since April 2005 ── */
(function() {
  const founded = new Date(2005, 3, 1);
  const now = new Date();
  let years = now.getFullYear() - founded.getFullYear();
  if (now < new Date(now.getFullYear(), 3, 1)) years--;
  const label = years + '+ Years on the Ground';
  ['stat-years','ticker-years','ticker-years2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'stat-years' ? years + '+' : label;
  });
})();

/* ── Copy link ── */
function copyLink(id) {
  const url = window.location.href.split('#')[0];
  navigator.clipboard.writeText(url).then(() => {
    const el = document.getElementById(id);
    if (el) { el.style.display='inline'; setTimeout(()=>el.style.display='none',3000); }
  }).catch(() => prompt('Copy this link:', url));
}

/* ── Auth Session Check ── */
(async function() {
  // Skip on login page
  if (window.location.pathname === '/login' || window.location.pathname === '/login.html') return;

  try {
    // Try to get token from localStorage first
    let token = localStorage.getItem('vazhai_session');

    // Also check cookie
    const match = document.cookie.match(/vazhai_session=([^;]+)/);
    if (match && !token) {
      token = match[1];
    }

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/auth/check', { headers });
    const data = await res.json();

    if (data.authenticated) {
      // Replace login link with email (as link to dashboard/user.html)
      // Both "Login" and "Logout" are replaced by just the email link.
      // The user can sign out from the dashboard itself.

      // Pattern A: common-bottom.html has #page-auth-area wrapping the login link
      const authArea = document.getElementById('page-auth-area');
      if (authArea) {
        authArea.innerHTML = `<a href="/dashboard" id="page-loggedin-email" style="color:var(--green-dark, #2d5a3f);font-size:11px;font-weight:600;text-decoration:none;">${data.email}</a>`;
      }

      // Pattern B: pages with inline #page-login-link + #page-loggedin-email (hidden)
      const loginLink = document.getElementById('page-login-link');
      const emailSpan = document.getElementById('page-loggedin-email');
      if (loginLink) {
        loginLink.style.display = 'none';
      }
      if (emailSpan) {
        emailSpan.innerHTML = `<a href="/dashboard" style="color:var(--green-dark, #2d5a3f);font-size:11px;font-weight:600;text-decoration:none;">${data.email}</a>`;
        emailSpan.style.display = '';
      }

      // Keep logout container hidden — email replaces both Login and Logout
      const logoutContainer = document.getElementById('page-logout-link-container');
      if (logoutContainer) {
        logoutContainer.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('Auth check failed', e);
  }
})();

/* ── Hash-based redirect (backward compatibility with old SPA links) ── */
(function() {
  const hashMap = {
    'home':        '/',
    'who-we-are':  '/who-we-are',
    'what-we-do':  '/what-we-do',
    'join-vazhai': '/join',
    'donation':   '/donate',
    'contact-us': '/contact',
    'vazhai-events': '/events'
  };
  const hash = window.location.hash.replace('#','');
  if (hash && hashMap[hash]) {
    // Only redirect if we're not already on the right page
    const target = hashMap[hash];
    const current = window.location.pathname.replace(/\/$/, '') || '/';
    if (current !== target) {
      window.location.replace(target);
    }
  }
})();
