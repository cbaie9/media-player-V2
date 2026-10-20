'use strict';

/**
 * manwa.js — Lecteur Manwa (V1.4).
 *
 * Chargé en `type="module"` (deferred), mais n'importe rien : accès via
 * `window.api`, `window.readerState`, `window.__meReady` et événements
 * personnalisés.
 *
 * V1.4.1 :
 *   - `enterManwa` applique l'UI AVANT de scroller
 *   - Flag `ctx.syncing` : activeObserver muselé pendant la sync programmatique
 *
 * V1.4.2 :
 *   - Expose `window.__manwaReady` (booléen) après construction de la liste
 *
 * V1.4.3 (fix terrain « retour à la page précédente ») :
 *   - `scrollIntoView` déplacé dans un `requestAnimationFrame` : la classe
 *     `html.manwa-mode` vient d'être appliquée, mais le layout du conteneur
 *     n'est pas encore recalculé au moment du scroll synchrone → scrollIntoView
 *     est un no-op (bug reproduit en usage manuel : manwa → classic → next →
 *     manwa ramène à la page précédente).
 *   - Re-check explicite au relâchement de `syncing` : calcule l'item qui
 *     croise le centre du viewport et force `state.index`. Sans ce re-check,
 *     un scroll manuel pendant la fenêtre de `syncing` était ignoré par
 *     l'observer (IntersectionObserver ne re-fire pas sans nouvelle
 *     intersection après le relâchement).
 *   - `SYNC_RELEASE_MS` porté à 300 ms pour couvrir le rAF + settle.
 */

const MANWA_ROOT_MARGIN = '100% 0px 100% 0px';
const COOKIE_NAME = 'reader_mode';
const COOKIE_MAX_AGE = 31536000; // 1 an
const SYNC_RELEASE_MS = 300;

const PAGE_ID = (idx) => 'page-' + String(idx).padStart(6, '0');

function readCookieMode() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)reader_mode=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function writeCookieMode(mode) {
  try {
    document.cookie =
      COOKIE_NAME + '=' + mode +
      '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Construction de la liste
// ---------------------------------------------------------------------------
function buildList(ul, serie, folder, pages) {
  const frag = document.createDocumentFragment();

  pages.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'manwa-item';
    li.id = PAGE_ID(idx);
    li.dataset.index = String(idx);
    li.tabIndex = 0;

    if (p.type === 'image') {
      const img = document.createElement('img');
      img.alt = 'Page ' + p.num;
      img.dataset.src = window.api.mediaUrl(serie, folder, p.file);
      img.src = window.api.placeholder();
      img.addEventListener('error', () => {
        img.src = window.api.brokenPlaceholder();
      });
      li.appendChild(img);
    } else if (p.type === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.dataset.src = window.api.mediaUrl(serie, folder, p.file);
      li.appendChild(video);
    }

    frag.appendChild(li);
  });

  ul.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Lazy loading
// ---------------------------------------------------------------------------
function setupLazy(root, ul) {
  if (!('IntersectionObserver' in window)) {
    ul.querySelectorAll('[data-src]').forEach((el) => {
      el.src = el.dataset.src;
      el.removeAttribute('data-src');
    });
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const media = entry.target.querySelector('[data-src]');
        if (media) {
          media.src = media.dataset.src;
          media.removeAttribute('data-src');
        }
        io.unobserve(entry.target);
      }
    },
    { root, rootMargin: MANWA_ROOT_MARGIN, threshold: 0 }
  );

  ul.querySelectorAll('.manwa-item').forEach((li) => io.observe(li));
}

// ---------------------------------------------------------------------------
// Suivi de la page active
// ---------------------------------------------------------------------------
function setupActive(root, ul, state, ctx) {
  if (!('IntersectionObserver' in window)) return;

  const io = new IntersectionObserver(
    (entries) => {
      if (ctx.syncing) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          state.index = Number(entry.target.dataset.index);
        }
      }
    },
    { root, rootMargin: '-50% 0px -50% 0px', threshold: 0 }
  );

  ul.querySelectorAll('.manwa-item').forEach((li) => io.observe(li));
}

// ---------------------------------------------------------------------------
// Scrollspy de fin
// ---------------------------------------------------------------------------
function setupEnd(root, sentinel, pages, announce) {
  let activated = pages.length > 1;

  function trigger() {
    announce.textContent = 'Fin du comics';
    window.dispatchEvent(new CustomEvent('reader:end-reached'));
  }

  function checkAndTriggerIfAtBottom() {
    if (!activated) return;
    const r = sentinel.getBoundingClientRect();
    const rootR = root.getBoundingClientRect();
    if (r.top < rootR.bottom) trigger();
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && activated) trigger();
      },
      { root, threshold: 0.1 }
    );
    io.observe(sentinel);
  }

  if (!activated) {
    const onScroll = () => {
      activated = true;
      root.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      checkAndTriggerIfAtBottom();
    };
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'End') {
        activated = true;
        document.removeEventListener('keydown', onKey);
        root.removeEventListener('scroll', onScroll);
        checkAndTriggerIfAtBottom();
      }
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
  }
}

// ---------------------------------------------------------------------------
// Vidéo
// ---------------------------------------------------------------------------
function saveVideoTimeFromClassic(state) {
  const video = document.querySelector('#page-container video');
  if (video && !Number.isNaN(video.currentTime)) {
    state.currentVideoTime = video.currentTime;
  }
}

function saveVideoTimeFromManwa(state) {
  const li = document.getElementById(PAGE_ID(state.index));
  if (!li) return;
  const video = li.querySelector('video');
  if (video && !Number.isNaN(video.currentTime)) {
    state.currentVideoTime = video.currentTime;
  }
}

function forceLoadMedia(li) {
  if (!li) return;
  const media = li.querySelector('[data-src]');
  if (media) {
    media.src = media.dataset.src;
    media.removeAttribute('data-src');
  }
}

function restoreVideoTimeInManwa(state) {
  if (state.currentVideoTime == null) return;
  const li = document.getElementById(PAGE_ID(state.index));
  if (!li) return;
  forceLoadMedia(li);
  const video = li.querySelector('video');
  if (!video) return;
  const t = state.currentVideoTime;
  state.currentVideoTime = null;
  const restore = () => { try { video.currentTime = t; } catch { /* ignore */ } };
  if (video.readyState >= 1) restore();
  else video.addEventListener('loadedmetadata', restore, { once: true });
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function applyModeUI(mode, ctx) {
  const state = ctx.state;
  state.mode = mode;

  const html = document.documentElement;
  const toggleBtn = ctx.toggleBtn;

  if (mode === 'manwa') {
    html.classList.add('manwa-mode');
    if (toggleBtn) {
      toggleBtn.textContent = 'Passer en mode Classique';
      toggleBtn.setAttribute('aria-pressed', 'true');
    }
    if (ctx.manwaReader) {
      try { ctx.manwaReader.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  } else {
    html.classList.remove('manwa-mode');
    if (toggleBtn) {
      toggleBtn.textContent = 'Passer en mode Manwa';
      toggleBtn.setAttribute('aria-pressed', 'false');
    }
  }
}

// ---------------------------------------------------------------------------
// V1.4.3 — Re-check : force state.index sur l'item qui croise le centre
// du viewport (même logique que l'activeObserver via rootMargin -50%).
// ---------------------------------------------------------------------------
function recheckActiveIndex(ctx) {
  const root = ctx.manwaReader;
  const list = ctx.manwaList;
  if (!root || !list) return;

  const rootRect = root.getBoundingClientRect();
  const centerY = rootRect.top + rootRect.height / 2;
  const items = list.querySelectorAll('.manwa-item');
  let best = null;
  let bestDist = Infinity;

  for (const li of items) {
    const r = li.getBoundingClientRect();
    if (r.bottom < rootRect.top || r.top > rootRect.bottom) continue;
    const mid = (r.top + r.bottom) / 2;
    const d = Math.abs(mid - centerY);
    if (d < bestDist) {
      bestDist = d;
      best = li;
    }
  }
  if (best) {
    ctx.state.index = Number(best.dataset.index);
  }
}

// ---------------------------------------------------------------------------
// Entrée / sortie du mode Manwa
// ---------------------------------------------------------------------------
function enterManwa(ctx, targetIndex) {
  const state = ctx.state;

  ctx.syncing = true;
  applyModeUI('manwa', ctx);

  const li = document.getElementById(PAGE_ID(targetIndex));
  if (li) {
    const prev = li.style.contentVisibility;
    li.style.contentVisibility = 'visible';
    forceLoadMedia(li);

    // V1.4.3 — scrollIntoView DANS un rAF : la classe html.manwa-mode vient
    // d'être posée mais le layout du conteneur n'est pas encore recalculé.
    // Un scrollIntoView synchrone est un no-op (bug terrain confirmé).
    requestAnimationFrame(() => {
      li.scrollIntoView({ block: 'start', behavior: 'auto' });
      if (state.currentVideoTime != null) restoreVideoTimeInManwa(state);
      requestAnimationFrame(() => {
        li.style.contentVisibility = prev || '';
      });
    });
  }

  state.index = targetIndex;

  setTimeout(() => {
    ctx.syncing = false;
    // V1.4.3 — Re-check : l'observer a pu ignorer un scroll manuel pendant
    // la fenêtre de syncing (IntersectionObserver ne re-fire pas sans
    // nouvelle intersection). On force state.index sur l'item visible.
    recheckActiveIndex(ctx);
  }, SYNC_RELEASE_MS);

  writeCookieMode('manwa');
  window.dispatchEvent(
    new CustomEvent('reader:mode-change', { detail: { mode: 'manwa' } })
  );
}

function exitManwa(ctx) {
  const state = ctx.state;
  const targetIndex = state.index;

  saveVideoTimeFromManwa(state);
  applyModeUI('classic', ctx);
  writeCookieMode('classic');
  state.index = targetIndex;

  window.dispatchEvent(
    new CustomEvent('reader:mode-change', { detail: { mode: 'classic' } })
  );
}

function switchMode(newMode, ctx) {
  const state = ctx.state;
  if (state.mode === newMode) return;

  if (newMode === 'manwa') {
    saveVideoTimeFromClassic(state);
    enterManwa(ctx, state.index);
  } else {
    exitManwa(ctx);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  window.__manwaReady = false;

  if (window.__meReady) {
    try { await window.__meReady; } catch { return; }
  }

  if (!window.readerState || !window.readerState.pages || window.readerState.pages.length === 0) {
    const gotReady = await new Promise((resolve) => {
      const onReady = () => { cleanup(); resolve(true); };
      const onError = () => { cleanup(); resolve(false); };
      function cleanup() {
        window.removeEventListener('reader:ready', onReady);
        window.removeEventListener('reader:error', onError);
      }
      window.addEventListener('reader:ready', onReady, { once: true });
      window.addEventListener('reader:error', onError, { once: true });
      setTimeout(() => { cleanup(); resolve(false); }, 10000);
    });
    if (!gotReady) {
      window.__manwaReady = true;
      return;
    }
  }

  const state = window.readerState;
  if (!state || !state.pages || state.pages.length === 0) {
    window.__manwaReady = true;
    return;
  }

  const { serie, folder, pages } = state;
  const toggleBtn = document.getElementById('reader-toggle');
  const manwaReader = document.getElementById('manwa-reader');
  const manwaList = document.getElementById('manwa-list');
  const endSentinel = document.getElementById('manwa-end-sentinel');
  const endAnnounce = document.getElementById('manwa-end-announce');

  const ctx = {
    state,
    toggleBtn,
    manwaReader,
    manwaList,
    syncing: false,
  };

  // Comics video-only : toggle masqué, classic forcé
  const hasImage = pages.some((p) => p.type === 'image');
  if (!hasImage) {
    document.documentElement.classList.remove('manwa-mode');
    window.__manwaReady = true;
    return;
  }

  buildList(manwaList, serie, folder, pages);

  setupLazy(manwaReader, manwaList);
  setupActive(manwaReader, manwaList, state, ctx);
  setupEnd(manwaReader, endSentinel, pages, endAnnounce);

  if (toggleBtn) {
    toggleBtn.hidden = false;
    toggleBtn.addEventListener('click', () => {
      const target = state.mode === 'manwa' ? 'classic' : 'manwa';
      switchMode(target, ctx);
    });
  }

  const cookieMode = readCookieMode();
  const initialMode =
    document.documentElement.classList.contains('manwa-mode') ||
    cookieMode === 'manwa'
      ? 'manwa'
      : 'classic';

  state.mode = 'classic';

  if (initialMode === 'manwa') {
    enterManwa(ctx, 0);
  } else {
    applyModeUI('classic', ctx);
    writeCookieMode('classic');
  }

  window.__manwaReady = true;
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => {
    if (typeof console !== 'undefined') {
      console.warn('[manwa] init failed:', e);
    }
    window.__manwaReady = true;
  });
});