/* ═══════════════════════════════════════════════════
   DONOR TICKER — public rolling "news" of recent donors
   Fetches /donor-wall (sanitized, cache 5 min) and renders
   a seamless marquee. Falls back gracefully on error/empty.
═══════════════════════════════════════════════════ */

(function() {
  const CACHE_KEY = 'vazhai_donor_wall';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // i18n: pick strings based on <html lang>
  const lang = (document.documentElement.lang || 'en').toLowerCase();
  const STRINGS = {
    en: {
      eyebrow: '💛 Recent Supporters',
      fallback: 'Be the first to support a child this month → Donate',
    },
    ta: {
      eyebrow: '💛 சமீபத்திய நன்கொடையாளர்கள்',
      fallback: 'இந்த மாதம் முதல் நன்கொடையாளராக இருங்கள் → நன்கொடை',
    },
  };
  const S = STRINGS[lang] || STRINGS.en;

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
      // Fail soft — use empty so fallback shows
      donors = [];
    }

    // Cache
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ _ts: Date.now(), donors }));
    } catch (_) {}

    return donors;
  }

  function init() {
    const inner = document.getElementById('donor-ticker-inner');
    if (!inner) return;

    // Set eyebrow label from JS so i18n works without per-page markup differences
    const eyebrowEl = document.querySelector('.donor-ticker-eyebrow');
    if (eyebrowEl) eyebrowEl.textContent = S.eyebrow;

    fetchDonors().then(donors => {
      if (!donors || donors.length === 0) {
        // Fallback message
        const fallback = document.createElement('span');
        fallback.className = 'dt-fallback';
        fallback.textContent = S.fallback;
        // Link to donate
        const wrap = document.createElement('a');
        wrap.href = lang.startsWith('ta') ? '/ta/donate' : '/donate';
        wrap.style.textDecoration = 'none';
        wrap.style.color = 'inherit';
        wrap.appendChild(fallback);
        // Duplicate for the seamless -50% loop
        inner.appendChild(wrap.cloneNode(true));
        inner.appendChild(wrap.cloneNode(true));
        return;
      }

      // Build one full pass of donor items
      const buildPass = () => {
        const frag = document.createDocumentFragment();
        for (const d of donors) {
          const span = document.createElement('span');
          span.className = 'dt-item';

          const name = document.createElement('strong');
          name.textContent = d.name || 'Anonymous';

          span.appendChild(name);

          if (d.message && d.message.trim()) {
            const msg = document.createElement('em');
            msg.className = 'dt-msg';
            msg.textContent = ' — ' + d.message.trim();
            span.appendChild(msg);
          }

          if (d.month) {
            const month = document.createElement('span');
            month.className = 'dt-month';
            month.textContent = ' · ' + d.month;
            span.appendChild(month);
          }

          frag.appendChild(span);
        }
        return frag;
      };

      // Duplicate the pass twice for a seamless translateX(-50%) loop
      const pass1 = buildPass();
      const pass2 = buildPass();
      inner.appendChild(pass1);
      inner.appendChild(pass2);
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();