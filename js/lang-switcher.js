/* ═══════════════════════════════════════════════════
   LANG SWITCHER — handles language switching
   Maps English URLs to Tamil URLs and vice versa
════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const pageMap = {
    '/':                  '/ta/',
    '/index.html':        '/ta/',
    '/who-we-are':        '/ta/who-we-are',
    '/who-we-are.html':   '/ta/who-we-are',
    '/what-we-do':        '/ta/what-we-do',
    '/what-we-do.html':   '/ta/what-we-do',
    '/join':              '/ta/join',
    '/join.html':         '/ta/join',
    '/donate':            '/ta/donate',
    '/donate.html':       '/ta/donate',
    '/contact':           '/ta/contact',
    '/contact.html':      '/ta/contact',
    '/events':            '/ta/events',
    '/events.html':       '/ta/events',
    '/login':             '/ta/login',
    '/login.html':        '/ta/login',
    '/vazhai':            '/ta/vazhai',
    '/vazhai.html':       '/ta/vazhai',
    '/thankyou':          '/ta/thankyou',
    '/thankyou.html':     '/ta/thankyou',
    '/404':               '/ta/404',
    '/404.html':          '/ta/404',
    '/terms':             '/ta/terms',
    '/terms.html':        '/ta/terms',
    '/privacy-policy':    '/ta/privacy-policy',
    '/privacy-policy.html': '/ta/privacy-policy',
    '/blog':              '/ta/blog',
    '/donors':            '/ta/donors',
    '/donors.html':       '/ta/donors',
  };

  const reverseMap = {};
  for (const [en, ta] of Object.entries(pageMap)) {
    reverseMap[ta] = en;
  }

  // Get the current language from pathname or localStorage
  function getCurrentLang() {
    const path = window.location.pathname;
    if (path.startsWith('/ta/') || path === '/ta') {
      return 'ta';
    }
    return 'en';
  }

  // Get the alternate language URL
  function getAlternateUrl() {
    const path = window.location.pathname;
    const currentLang = getCurrentLang();

    // Handle blog post URLs dynamically: /blog/{slug} or /ta/blog/{slug}
    if (currentLang === 'en') {
      // Check if this is a blog post page (/blog/...)
      const blogMatch = path.match(/^\/blog\/(.+)/);
      if (blogMatch) {
        const slug = blogMatch[1];
        // If /blog/{slug}, map to /ta/blog/{slug}
        return '/ta/blog/' + slug;
      }
      return pageMap[path] || pageMap[path + '.html'] || '/ta/';
    } else {
      // Check if this is a Tamil blog post page (/ta/blog/...)
      const blogMatch = path.match(/^\/ta\/blog\/(.+)/);
      if (blogMatch) {
        const slug = blogMatch[1];
        // If /ta/blog/{slug}, map to /blog/{slug}
        return '/blog/' + slug;
      }
      return reverseMap[path] || reverseMap[path + '.html'] || '/';
    }
  }

  // Update all language links on the page
  function updateLangLinks() {
    const currentLang = getCurrentLang();
    const altUrl = getAlternateUrl();

    document.querySelectorAll('.lang-link').forEach(el => {
      if (el.dataset.lang === currentLang) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
        // Update the href to point to the alternate URL
        if (currentLang === 'en') {
          el.href = altUrl;
        } else {
          el.href = altUrl;
        }
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateLangLinks);
  } else {
    updateLangLinks();
  }
})();