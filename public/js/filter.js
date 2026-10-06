'use strict';

/**
 * filter.js — logique pure de recherche + filtre [X,Y] + tri (V1.1, A + C).
 *
 * Ce module est volontairement SANS dépendance DOM : il est testable en
 * Node (tests/unit/filter.test.js) et utilisable côté navigateur via
 * window.filterLib.
 *
 * Contrat d'entrée : chaque item = { name, pageCount, cover, hasVideo }
 * (ce que renvoie /api/series/:serie).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // Node
  } else {
    root.filterLib = api; // Navigateur
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Tri par défaut (C2) */
  const SORTS = ['alpha', 'pages_asc', 'pages_desc'];
  const DEFAULT_SORT = 'alpha';
  const DEFAULT_MIN = 0;
  const DEFAULT_MAX = null; // null = ∞

  // -------------------------------------------------------------------------
  // Recherche (A)
  // -------------------------------------------------------------------------

  /**
   * Normalise une chaîne pour le matching : lowercase + trim.
   * A4 + A8 du CDC V1.1.
   */
  function normalize(str) {
    return String(str == null ? '' : str).toLowerCase().trim();
  }

  /**
   * Teste si un item matche la requête (substring insensible à la casse).
   * A3 : `includes` sur nom normalisé lowercase.
   * A11 : ne matche PAS le numéro de page (on ne regarde que `name`).
   */
  function matchesQuery(item, query) {
    const q = normalize(query);
    if (!q) return true;
    return normalize(item.name).includes(q);
  }

  // -------------------------------------------------------------------------
  // Filtre [X,Y] (C)
  // -------------------------------------------------------------------------

  /**
   * Normalise les bornes [X, Y] (C4, C5, C8).
   *  - X minimum forcé à 0
   *  - X > Y → inversion silencieuse
   *  - Y vide → ∞ (null)
   *
   * @returns {{ min: number, max: number|null }}
   */
  function normalizeBounds(min, max) {
    let lo = parseInt(min, 10);
    let hi = parseInt(max, 10);

    if (Number.isNaN(lo)) lo = DEFAULT_MIN;
    if (Number.isNaN(hi)) hi = DEFAULT_MAX;

    if (lo < 0) lo = 0;
    if (hi !== null && hi < 0) hi = 0;

    // C8 : X > Y → inversion silencieuse
    if (hi !== null && lo > hi) {
      [lo, hi] = [hi, lo];
    }

    return { min: lo, max: hi };
  }

  /**
   * Teste si un item est dans l'intervalle [min, max] inclusif.
   * C1, C11 : pageCount = 0 → exclu dans TOUS les cas.
   *
   * @returns {{ ok: boolean, reason?: string }}
   */
  function matchesRange(item, min, max) {
    const n = Number(item.pageCount);
    if (!Number.isFinite(n)) {
      return { ok: false, reason: 'invalid_page_count' };
    }
    if (n === 0) {
      return { ok: false, reason: 'zero_page_count' };
    }
    if (n < min) return { ok: false };
    if (max !== null && n > max) return { ok: false };
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Tri (C2)
  // -------------------------------------------------------------------------

  /**
   * Comparateur de tri.
   * @param {'alpha'|'pages_asc'|'pages_desc'} sort
   */
  function comparator(sort) {
    switch (sort) {
      case 'pages_asc':
        return (a, b) =>
          a.pageCount - b.pageCount || a.name.localeCompare(b.name);
      case 'pages_desc':
        return (a, b) =>
          b.pageCount - a.pageCount || a.name.localeCompare(b.name);
      case 'alpha':
      default:
        return (a, b) => a.name.localeCompare(b.name);
    }
  }

  // -------------------------------------------------------------------------
  // Fonction principale
  // -------------------------------------------------------------------------

  /**
   * Applique recherche + filtre + tri.
   *
   * @param {object} params
   * @param {Array<{name:string,pageCount:number,hasVideo?:boolean}>} params.items
   * @param {string} [params.query='']
   * @param {number|string} [params.min=0]
   * @param {number|string|null} [params.max=null]
   * @param {'alpha'|'pages_asc'|'pages_desc'} [params.sort='alpha']
   * @param {(msg:string)=>void} [params.onAnomaly] - callback pour pageCount=0
   * @returns {Array<object>} Nouvelle liste filtrée + triée
   */
  function apply(items, params) {
    const opts = params || {};
    const query = opts.query || '';
    const { min, max } = normalizeBounds(opts.min, opts.max);
    const sort = SORTS.includes(opts.sort) ? opts.sort : DEFAULT_SORT;
    const onAnomaly = typeof opts.onAnomaly === 'function' ? opts.onAnomaly : null;

    const list = Array.isArray(items) ? items : [];

    // C11 : pageCount = 0 → exclu + console.error
    const filtered = [];
    for (const it of list) {
      const r = matchesRange(it, min, max);
      if (!r.ok) {
        if (r.reason === 'zero_page_count' && onAnomaly) {
          onAnomaly(`pageCount=0 pour "${it.name}"`);
        }
        continue;
      }
      if (!matchesQuery(it, query)) continue;
      filtered.push(it);
    }

    // A5 : illimité en nombre de résultats
    filtered.sort(comparator(sort));
    return filtered;
  }

  // -------------------------------------------------------------------------
  // URL (C7, E5)
  // -------------------------------------------------------------------------

  /**
   * Lit min/max/sort depuis un objet URLSearchParams-compatible.
   * E5 : rétrocompat URL sans query string.
   */
  function parseFromSearch(search) {
    const sp = search instanceof URLSearchParams
      ? search
      : new URLSearchParams(String(search || ''));

    const rawMin = sp.get('min');
    const rawMax = sp.get('max');
    const rawSort = sp.get('sort');

    const hasMin = rawMin !== null && rawMin !== '';
    const hasMax = rawMax !== null && rawMax !== '';
    const hasSort = rawSort !== null && rawSort !== '';

    const bounds = normalizeBounds(
      hasMin ? rawMin : DEFAULT_MIN,
      hasMax ? rawMax : DEFAULT_MAX
    );

    return {
      min: bounds.min,
      max: bounds.max,
      // On garde la trace "vide" pour l'input Y
      rawMax: hasMax ? String(bounds.max) : '',
      sort: hasSort && SORTS.includes(rawSort) ? rawSort : DEFAULT_SORT,
      hasMin,
      hasMax,
      hasSort,
    };
  }

  /**
   * Sérialise un état vers une query string.
   * C7 : ?min=&max=&sort=
   * C4 : ne sérialise QUE les valeurs non-défaut (URL propre).
   */
  function buildSearch({ min, max, sort }) {
    const sp = new URLSearchParams();
    const defaults = normalizeBounds(DEFAULT_MIN, DEFAULT_MAX);

    if (typeof min === 'number' && min !== defaults.min) {
      sp.set('min', String(min));
    }
    if (typeof max === 'number' && max !== defaults.max) {
      sp.set('max', String(max));
    }
    if (sort && sort !== DEFAULT_SORT) {
      sp.set('sort', sort);
    }
    return sp.toString();
  }

  return {
    // Constantes
    SORTS,
    DEFAULT_SORT,
    DEFAULT_MIN,
    DEFAULT_MAX,
    // Recherche
    normalize,
    matchesQuery,
    // Filtre
    normalizeBounds,
    matchesRange,
    // Tri
    comparator,
    // Main
    apply,
    // URL
    parseFromSearch,
    buildSearch,
  };
});