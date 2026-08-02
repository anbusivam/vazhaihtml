/* ═══════════════════════════════════════════════════
   DONOR SPOTLIGHT — floating rotating donor name
   Fetches /donor-wall (sanitized, cache 5 min) and
   displays one donor name at a time at the top of
   the viewport with fade in/out animations.
   Falls back gracefully on error/empty.
═══════════════════════════════════════════════════ */

(function() {
  const CACHE_KEY = 'vazhai_donor_wall';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // i18n: pick strings based on <html lang>
  const lang = (document.documentElement.lang || 'en').toLowerCase();
  const STRINGS = {
    en: {
      label: '✦ Thanking our recent donor',
      fallback: 'Be the first to support → Donate',
    },
    ta: {
      label: '✦ சமீபத்தில் நன்கொடையளித்தவருக்கு நன்றி',
      fallback: 'முதல் நன்கொடையாளராக இருங்கள் → நன்கொடை',
    },
  };
  const S = STRINGS[lang] || STRINGS.en;

  const SHOW_MS = 3500;   // How long each donor stays visible
  const FADE_MS = 600;    // Fade transition duration

  async function fetchDonors() {
    // Try sessionStorage cache first
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed._ts && Date.now() - parsed._ts < CACHE_TTL) {
          return parsed.donors || [];
        }
      }
    } catch (_) {}

    let donors = [];
    try {
      const res = await fetch('/donor-wall', { headers: { 'Cache-Control': 'max-age=300' } });
      const data = await res.json();
      donors = Array.isArray(data.donors) ? data.donors : [];
    } catch (_) {
      donors = [];
    }

    // Cache
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ _ts: Date.now(), donors }));
    } catch (_) {}

    return donors;
  }

  function createSpotlight() {
    // Build the floating pill element
    const pill = document.createElement('div');
    pill.className = 'donor-spotlight';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');

    // Label (small uppercase text)
    const label = document.createElement('span');
    label.className = 'donor-spotlight-label';
    label.textContent = S.label;
    pill.appendChild(label);

    // Donor name (big bold)
    const name = document.createElement('span');
    name.className = 'donor-spotlight-name';
    pill.appendChild(name);

    document.body.appendChild(pill);
    return { pill, name };
  }

  function init() {
    // Check if we should run (no old ticker markup needed; we self-inject)
    const spot = createSpotlight();
    const { pill, name } = spot;

    fetchDonors().then(donors => {
      // No donors — show fallback once, then hide
      if (!donors || donors.length === 0) {
        name.textContent = S.fallback;
        // Make it a link
        const link = document.createElement('a');
        link.href = lang.startsWith('ta') ? '/ta/donate' : '/donate';
        link.style.textDecoration = 'underline';
        link.style.color = 'inherit';
        link.textContent = S.fallback;
        name.innerHTML = '';
        name.appendChild(link);

        pill.classList.add('show');
        setTimeout(() => pill.classList.remove('show'), SHOW_MS + FADE_MS * 2);
        return;
      }

      // Build array of names only
      const names = donors.map(d => d.name || 'Anonymous');

      let idx = 0;
      let timer = null;

      function showNext() {
        name.textContent = names[idx % names.length];
        idx++;

        pill.classList.add('show');

        // After show duration, fade out and then show next
        clearTimeout(timer);
        timer = setTimeout(() => {
          pill.classList.remove('show');
          // After fade-out completes, show next
          setTimeout(showNext, FADE_MS + 400);
        }, SHOW_MS);
      }

      // Start the cycle
      showNext();
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();