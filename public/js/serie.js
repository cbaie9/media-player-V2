'use strict';

/**
 * serie.js — page « Série » (V1.1).
 *
 * Implémente :
 *  - Recherche live scopée à la série (A1-A12) + debounce 250 ms (A4)
 *  - Filtre [X,Y] + tri (C1-C12)
 *  - Persistance URL (C7)
 *  - Reset du filtre au changement d'onglet (C9)
 *  - Vignettes vidéo côté client (B14) via thumb.js + lazy.js
 */
document.addEventListener('DOMContentLoaded', async () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const serie = decodeURIComponent(parts[1] || '');
  if (!serie) {
    window.location.href = '/';
    return;
  }

  document.getElementById('serie-title').textContent = serie;
  document.title = serie + ' · Media Player V2';

  // --- Références DOM ----------------------------------------------------
  const listEl = document.getElementById('comics-list');
  const noResultsEl = document.getElementById('no-results');
  const tabs = document.querySelectorAll('[role="tab"]');

  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');

  const minInput = document.getElementById('filter-min');
  const maxInput = document.getElementById('filter-max');
  const sortSelect = document.getElementById('filter-sort');
  const resetBtn = document.getElementById('filter-reset');

  // --- État --------------------------------------------------------------
  /** @type {{ comics: Array<object>, img: Array<object> }} */
  let data = { comics: [], img: [] };
  let activeTab = 'comics';
  let query = '';
  let min = filterLib.DEFAULT_MIN;
  let max = filterLib.DEFAULT_MAX;
  let sort = filterLib.DEFAULT_SORT;

  // --- Initialisation URL (C7, E5) --------------------------------------
  function readUrlState() {
    const parsed = filterLib.parseFromSearch(window.location.search);
    min = parsed.min;
    max = parsed.max;
    sort = parsed.sort;
  }

  function writeUrlState() {
    const qs = filterLib.buildSearch({ min, max, sort });
    const url = qs
      ? window.location.pathname + '?' + qs
      : window.location.pathname;
    window.history.replaceState(null, '', url);
  }

  function syncInputsFromState() {
    searchInput.value = query;
    searchClear.hidden = !query;

    minInput.value = String(min);
    // C4 : max vide = ∞
    maxInput.value = max === null ? '' : String(max);
    sortSelect.value = sort;
  }

  function readInputsToState() {
    query = searchInput.value;
    const rawMin = minInput.value;
    const rawMax = maxInput.value;
    const bounds = filterLib.normalizeBounds(
      rawMin === '' ? filterLib.DEFAULT_MIN : rawMin,
      rawMax === '' ? filterLib.DEFAULT_MAX : rawMax
    );
    min = bounds.min;
    max = bounds.max;
    sort = sortSelect.value;
  }

  // --- Rendu -------------------------------------------------------------

  function pageWord(n) {
    return n > 1 ? 'pages' : 'page';
  }

  /**
   * Construit la vignette d'un comics.
   *
   * - Si le comics contient une vidéo (hasVideo), on utilise un <img>
   *   placeholder initialisé à un placeholder ▶ puis observeVideoThumb()
   *   extrait la vignette côté client (B14).
   * - Sinon, on utilise le lazy-loading image classique (data-src).
   *
   * NB : B4 — la clé de cache est l'URL RELATIVE.
   */
  function renderThumb(c, folder) {
    const cover = c.cover
      ? api.mediaUrl(serie, folder, c.cover)
      : api.placeholder();

    if (c.hasVideo && c.cover) {
      // Vignette vidéo : on démarre sur le placeholder ▶, puis on observe.
      const videoUrl = api.mediaUrl(serie, folder, c.cover);
      const relKey = api.mediaRelKey(serie, folder, c.cover);
      return (
        '<img class="thumb thumb-video" ' +
        'src="' + api.videoPlaceholder() + '" ' +
        'data-video-url="' + api.escapeHtml(videoUrl) + '" ' +
        'data-video-key="' + api.escapeHtml(relKey) + '" ' +
        'alt="" loading="lazy">'
      );
    }

    // Image classique : lazy-load
    return (
      '<img class="thumb" ' +
      'src="' + api.placeholder() + '" ' +
      'data-src="' + api.escapeHtml(cover) + '" ' +
      'alt="" loading="lazy">'
    );
  }

  function render() {
    const source = data[activeTab] || [];

    const filtered = filterLib.apply(source, {
      query,
      min,
      max,
      sort,
      onAnomaly: (msg) => {
        // C11 : pageCount = 0 → console.error pour tracer
        console.error('[serie] ' + msg);
      },
    });

    // A7 : aucun résultat → on garde le champ rempli + message discret,
    // ET on affiche TOUS les comics de l'onglet (comportement CDC).
    let items = filtered;
    let noResults = false;

    if (source.length > 0 && filtered.length === 0) {
      noResults = true;
      // On réaffiche tout, mais sans filtre de recherche
      items = source
        .filter((it) => Number(it.pageCount) > 0) // C11 : on exclut pageCount=0
        .slice()
        .sort(filterLib.comparator(sort));
    }

    if (items.length === 0) {
      listEl.innerHTML =
        '<li class="empty">Aucun élément dans « ' + activeTab + ' ».</li>';
    } else {
      const html = items.map((c) => {
        const link =
          '/reader/' +
          encodeURIComponent(serie) +
          '/' +
          activeTab +
          '/' +
          encodeURIComponent(c.name);
        return [
          '<li class="card">',
          '  <a href="' + link + '">',
          '    ' + renderThumb(c, activeTab),
          '    <div class="meta">',
          '      <h3>' + api.escapeHtml(c.name) + '</h3>',
          '      <p>' + c.pageCount + ' ' + pageWord(c.pageCount) + '</p>',
          '    </div>',
          '  </a>',
          '</li>',
        ].join('\n');
      });
      listEl.innerHTML = html.join('\n');
    }

    // A7 : message discret « aucun résultat » si on a basculé sur tout
    noResultsEl.hidden = !noResults;
    if (noResults) {
      noResultsEl.textContent = 'Aucun résultat — tous les éléments sont affichés.';
    } else {
      noResultsEl.textContent = '';
    }

    // Lance les observateurs
    if (window.lazyObserve) window.lazyObserve(listEl);
    if (window.observeVideoThumb) {
      listEl
        .querySelectorAll('img.thumb-video[data-video-url]')
        .forEach((img) => window.observeVideoThumb(img));
    }
  }

  // --- Debounce (A4) -----------------------------------------------------
  let debounceTimer = null;
  function debouncedApply() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      readInputsToState();
      writeUrlState();
      render();
    }, 250);
  }

  function applyNow() {
    if (debounceTimer) clearTimeout(debounceTimer);
    readInputsToState();
    writeUrlState();
    render();
  }

  // --- Événements --------------------------------------------------------

  searchInput.addEventListener('input', () => {
    searchClear.hidden = !searchInput.value;
    debouncedApply();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    applyNow();
    searchInput.focus();
  });

  minInput.addEventListener('input', debouncedApply);
  maxInput.addEventListener('input', debouncedApply);
  sortSelect.addEventListener('change', applyNow);

  resetBtn.addEventListener('click', () => {
    min = filterLib.DEFAULT_MIN;
    max = filterLib.DEFAULT_MAX;
    sort = filterLib.DEFAULT_SORT;
    query = '';
    syncInputsFromState();
    applyNow();
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      activeTab = tab.dataset.tab;

      // C9 : reset du filtre au changement d'onglet
      min = filterLib.DEFAULT_MIN;
      max = filterLib.DEFAULT_MAX;
      sort = filterLib.DEFAULT_SORT;
      // A9 : la recherche est scopée à l'onglet actif → on la vide
      // quand on change d'onglet (le champ reste, mais on repart de zéro).
      query = '';
      syncInputsFromState();
      applyNow();
    });
  });

  // --- Chargement initial ------------------------------------------------

  try {
    data = await api.getJSON('/api/series/' + encodeURIComponent(serie));
  } catch (e) {
    listEl.innerHTML =
      '<li class="empty">Erreur : ' + api.escapeHtml(e.message) + '</li>';
    return;
  }

  readUrlState();
  syncInputsFromState();
  render();

  const back = document.getElementById('back-to-serie');
  if (back) back.setAttribute('href', '/serie/' + encodeURIComponent(serie));
});