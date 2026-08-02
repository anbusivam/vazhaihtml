/* ═══════════════════════════════════════════════════
   DONORS PAGE — "Thank You" donor list (last 12 months)
   Fetches /donor-wall (sanitized, cached 5 min), shuffles
   into a random order on every load, then renders donor
   cards. Falls back gracefully on error/empty.
═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  const CACHE_KEY = 'vazhai_donor_wall';
  const CACHE_TTL = 5 * 60 * 1000;

  const lang = (document.documentElement.lang || 'en').toLowerCase();

  const STRINGS = {
    en: {
      monthLabel: 'Donated',
      loadError: 'We couldn’t load our donor list right now. Please check back soon.',
      empty: 'Be the first to make a difference. Your support matters!',
    },
    ta: {
      monthLabel: 'நன்கொடை',
      loadError: 'எங்கள் நன்கொடையாளர் பட்டியலை இப்போது ஏற்ற முடியவில்லை. விரைவில் மீண்டும் பாருங்கள்.',
      empty: 'முதலில் ஆதரவளித்து மாற்றத்தை உருவாக்குங்கள். உங்கள் ஆதரவு முக்கியம்!',
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
      donors = [];
    }

    // Cache
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ _ts: Date.now(), donors }));
    } catch (_) {}

    return donors;
  }

  // Fisher–Yates shuffle — new random order every page load
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function render(donors) {
    const grid = document.getElementById('donor-grid');
    if (!grid) return;

    if (!donors || donors.length === 0) {
      grid.innerHTML = '<div class="donor-empty">' + S.empty + '</div>';
      return;
    }

    // New random order every time
    const shuffled = shuffle(donors);
    const frag = document.createDocumentFragment();

    shuffled.forEach(d => {
      const card = document.createElement('div');
      card.className = 'donor-card';

      const name = document.createElement('div');
      name.className = 'donor-card-name';
      name.textContent = d.name || 'Anonymous';

      card.appendChild(name);

      if (d.month && d.month.trim()) {
        const meta = document.createElement('div');
        meta.className = 'donor-card-meta';
        meta.textContent = S.monthLabel + ' · ' + d.month.trim();
        card.appendChild(meta);
      }

      if (d.message && d.message.trim()) {
        const msg = document.createElement('div');
        msg.className = 'donor-card-msg';
        msg.textContent = d.message.trim();
        card.appendChild(msg);
      }

      frag.appendChild(card);
    });

    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  async function init() {
    const grid = document.getElementById('donor-grid');
    if (!grid) return;

    try {
      const donors = await fetchDonors();
      render(donors);
    } catch (_) {
      grid.innerHTML = '<div class="donor-empty">' + S.loadError + '</div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();