'use strict';

/**
 * serie.js — page « Série » (V1.2).
 *
 * Implémente :
 *  - Recherche live scopée à la série (A1-A12) + debounce 250 ms (A4)
 *  - Filtre [X,Y] + tri (C1-C12)
 *  - Persistance URL (C7) — dont `?tab=` (V1.2)
 *  - Reset du filtre au changement d'onglet (C9)
 *  - Vignettes vidéo côté client (B14) via thumb.js + lazy.js
 *
 * V1.2 :
 *  - Onglets Comics / Images masqués si vides (pour le rôle courant)
 *  - Redirection auto vers l'onglet disponible si l'onglet par défaut
 *    est vide mais qu'un autre contient quelque chose
 *  - Si rien n'est accessible : message « Cette série est vide. »
 *  - 🔒 sur les comics admin-only (admin uniquement)
 *  - Le lien de chaque carte porte le `folder` réel (comics / comics_admin
 *    / img / img_admin) pour construire l'URL lecteur correcte
 *  - `?tab=` est lu au chargement et réécrit à chaque changement d'onglet
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

  // V1.2 — Attendre la résolution du rôle avant le rendu
  if (window.__meReady) {
    try {
      await window.__meReady;
    } catch {
      return;
    }
  }

  // --- Références DOM ----------------------------------------------------
  const listEl = document.getElementById('comics-list');
  const noResultsEl = document.getElementById('no-results');
  const tabsRow = document.querySelector('.tabs-row');
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

  // --- V1.2 : helpers onglets -------------------------------------------

  /**
   * Renvoie la liste brute d'un onglet (avant filtre).
   * @param {'comics'|'img'} tab
   */
  function rawListFor(tab) {
    return data[tab] || [];
  }

  /**
   * Un onglet est-il « disponible » (au moins 1 item) ?
   * @param {'comics'|'img'} tab
   */
  function isTabAvailable(tab) {
    return rawListFor(tab).length > 0;
  }

  /**
   * V1.2 — Série entièrement vide pour le rôle courant ?
   * (ni comics, ni img disponibles)
   */
  function isSerieEmpty() {
    return !isTabAvailable('comics') && !isTabAvailable('img');
  }

  /**
   * V1.2 — Met à jour l'UI des onglets :
   *   - masque un onglet s'il est vide
   *   - masque toute la ligne tabs-row si AUCUN onglet n'est disponible
   *   - sélectionne activeTab
   */
  function refreshTabsUI() {
    let anyAvailable = false;

    tabs.forEach((tab) => {
      const name = tab.dataset.tab;
      const available = isTabAvailable(name);
      tab.hidden = !available;
      tab.setAttribute(
        'aria-selected',
        name === activeTab && available ? 'true' : 'false'
      );
      if (available) anyAvailable = true;
    });

    if (tabsRow) tabsRow.hidden = !anyAvailable;
  }

  /**
   * V1.2 — Choisit l'onglet actif initial :
   *   1. ?tab= si valide et disponible
   *   2. sinon 'comics' s'il est disponible
   *   3. sinon 'img' s'il est disponible
   *   4. sinon 'comics' (par défaut, la page affichera « vide »)
   */
  function pickInitialTab() {
    const fromUrl = readUrlTab();
    const VALID = ['comics', 'img'];

    if (fromUrl && VALID.includes(fromUrl) && isTabAvailable(fromUrl)) {
      return fromUrl;
    }
    if (isTabAvailable('comics')) return 'comics';
    if (isTabAvailable('img')) return 'img';
    return 'comics';
  }

  /**
   * V1.2 — Lit ?tab= depuis l'URL.
   * @returns {'comics'|'img'|null}
   */
  function readUrlTab() {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get('tab');
    if (t === 'comics' || t === 'img') return t;
    return null;
  }

  // --- Initialisation URL (C7, E5, V1.2) --------------------------------
  function readUrlState() {
    const parsed = filterLib.parseFromSearch(window.location.search);
    min = parsed.min;
    max = parsed.max;
    sort = parsed.sort;
  }

  function writeUrlState() {
    const qs = filterLib.buildSearch({ min, max, sort });
    const sp = new URLSearchParams(qs);

    // V1.2 — on ne persiste `tab` QUE s'il diffère du défaut 'comics'
    if (activeTab && activeTab !== 'comics') {
      sp.set('tab', activeTab);
    }

    const finalQs = sp.toString();
    const url = finalQs
      ? window.location.pathname + '?' + finalQs
      : window.location.pathname;
    window.history.replaceState(null, '', url);
  }

  function syncInputsFromState() {
    searchInput.value = query;
    searchClear.hidden = !query;

    minInput.value = String(min);
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
   * V1.2 : `c.folder` est le folder RÉEL ('comics', 'comics_admin',
   * 'img', 'img_admin'). C'est ce folder qui sert à construire l'URL
   * média et la clé de cache des vignettes vidéo.
   */
  function renderThumb(c) {
    const cover = c.cover
      ? api.mediaUrl(serie, c.folder, c.cover)
      : api.placeholder();

    if (c.hasVideo && c.cover) {
      const videoUrl = api.mediaUrl(serie, c.folder, c.cover);
      const relKey = api.mediaRelKey(serie, c.folder, c.cover);
      return (
        '<img class="thumb thumb-video" ' +
        'src="' + api.videoPlaceholder() + '" ' +
        'data-video-url="' + api.escapeHtml(videoUrl) + '" ' +
        'data-video-key="' + api.escapeHtml(relKey) + '" ' +
        'alt="" loading="lazy">'
      );
    }

    return (
      '<img class="thumb" ' +
      'src="' + api.placeholder() + '" ' +
      'data-src="' + api.escapeHtml(cover) + '" ' +
      'alt="" loading="lazy">'
    );
  }

  /**
   * V1.2 — Série vide : on masque toute l'UI de filtres et on affiche
   * un message unique « Cette série est vide. ».
   */
  function renderEmptySerie() {
    listEl.innerHTML =
      '<li class="empty">Cette série est vide.</li>';
    noResultsEl.hidden = true;
    noResultsEl.textContent = '';
    refreshTabsUI();

    // On masque aussi les rangées de filtres / recherche (inutiles)
    const filtersRow = document.querySelector('.filters-row');
    if (filtersRow) filtersRow.hidden = true;
    const searchBox = document.querySelector('.search-box');
    if (searchBox) searchBox.hidden = true;
  }

  function render() {
    // V1.2 — Cas racine : série entièrement vide pour le rôle courant
    if (isSerieEmpty()) {
      renderEmptySerie();
      return;
    }

    const source = rawListFor(activeTab);

    // Onglet vide alors que l'autre ne l'est pas (ne devrait plus arriver
    // grâce à pickInitialTab, mais on sécurise)
    if (source.length === 0) {
      listEl.innerHTML =
        '<li class="empty">Aucun élément dans « ' + activeTab + ' ».</li>';
      noResultsEl.hidden = true;
      refreshTabsUI();
      return;
    }

    const filtered = filterLib.apply(source, {
      query,
      min,
      max,
      sort,
      onAnomaly: (msg) => {
        console.error('[serie] ' + msg);
      },
    });

    let items = filtered;
    let noResults = false;

    if (source.length > 0 && filtered.length === 0) {
      noResults = true;
      items = source
        .filter((it) => Number(it.pageCount) > 0)
        .slice()
        .sort(filterLib.comparator(sort));
    }

    if (items.length === 0) {
      listEl.innerHTML =
        '<li class="empty">Aucun élément dans « ' + activeTab + ' ».</li>';
    } else {
      const html = items.map((c) => {
        // V1.2 — lien avec le folder réel
        const link =
          '/reader/' +
          encodeURIComponent(serie) +
          '/' +
          encodeURIComponent(c.folder) +
          '/' +
          encodeURIComponent(c.name);
        const lock = api.lockBadge(c.adminOnly === true);
        return [
          '<li class="card">',
          '  <a href="' + link + '">',
          '    ' + renderThumb(c),
          '    <div class="meta">',
          '      <h3>' + api.escapeHtml(c.name) + lock + '</h3>',
          '      <p>' + c.pageCount + ' ' + pageWord(c.pageCount) + '</p>',
          '    </div>',
          '  </a>',
          '</li>',
        ].join('\n');
      });
      listEl.innerHTML = html.join('\n');
    }

    noResultsEl.hidden = !noResults;
    if (noResults) {
      noResultsEl.textContent =
        'Aucun résultat — tous les éléments sont affichés.';
    } else {
      noResultsEl.textContent = '';
    }

    if (window.lazyObserve) window.lazyObserve(listEl);
    if (window.observeVideoThumb) {
      listEl
        .querySelectorAll('img.thumb-video[data-video-url]')
        .forEach((img) => window.observeVideoThumb(img));
    }

    refreshTabsUI();
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
      activeTab = tab.dataset.tab;

      // C9 : reset du filtre au changement d'onglet
      min = filterLib.DEFAULT_MIN;
      max = filterLib.DEFAULT_MAX;
      sort = filterLib.DEFAULT_SORT;
      query = '';
      syncInputsFromState();
      applyNow();
    });
  });

  // --- Chargement initial ------------------------------------------------

  try {
    data = await api.getJSON('/api/series/' + encodeURIComponent(serie));
  } catch (e) {
    // V1.2 — 404 possible si série admin-only ouverte par un reader.
    if (e && e.status === 404) {
      listEl.innerHTML =
        '<li class="empty">Cette série est introuvable.</li>';
    } else {
      listEl.innerHTML =
        '<li class="empty">Erreur : ' + api.escapeHtml(e.message) + '</li>';
    }
    return;
  }

  // V1.2 — Sélection de l'onglet initial (avec ?tab= ou fallback)
  activeTab = pickInitialTab();

  readUrlState();
  syncInputsFromState();
  render();

  // V1.2 — Si l'onglet final n'est pas celui de l'URL, on réécrit l'URL
  writeUrlState();

  const back = document.getElementById('back-to-serie');
  if (back) back.setAttribute('href', '/serie/' + encodeURIComponent(serie));
});