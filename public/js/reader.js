'use strict';

/**
 * reader.js — page lecteur (V1.2 → V1.4).
 *
 * V1.2 :
 *   - 6 suggestions, 🔒 admin-only, slots vides, 404 géré
 *
 * V1.4 :
 *   - Expose `window.readerState` (source de vérité partagée avec manwa.js)
 *   - Émet `reader:ready` / `reader:error` pour synchroniser manwa.js
 *   - Écoute `reader:mode-change` : re-synchronise la page courante quand
 *     on revient en mode classic
 *   - Écoute `reader:end-reached` : déclenche l'overlay (émis par manwa.js)
 *   - `state.index` remplace la variable locale `index`
 *   - Sauvegarde/restauration de `currentVideoTime` au toggle
 *   - Raccourcis clavier désactivés en mode Manwa (sauf Échap)
 */
document.addEventListener('DOMContentLoaded', async () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const serie = decodeURIComponent(parts[1] || '');
  const folder = decodeURIComponent(parts[2] || '');
  const name = decodeURIComponent(parts[3] || '');

  // État partagé, défini dès maintenant (manwa.js peut le lire)
  window.readerState = {
    index: 0,
    pages: [],
    mode: 'classic',
    currentVideoTime: null,
    serie,
    folder,
    name,
  };
  const state = window.readerState;

  function emitError(reason) {
    window.dispatchEvent(
      new CustomEvent('reader:error', { detail: { reason: reason || 'unknown' } })
    );
  }

  if (!serie || !folder || !name) {
    emitError('invalid_url');
    window.location.href = '/';
    return;
  }

  if (window.__meReady) {
    try { await window.__meReady; } catch { emitError('me_failed'); return; }
  }

  const container = document.getElementById('page-container');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const indicator = document.getElementById('page-indicator');
  const overlay = document.getElementById('end-overlay');
  const suggestionsEl = document.getElementById('suggestions');
  const backMenu = document.getElementById('back-menu');
  const closeOverlay = document.getElementById('close-overlay');

  document.getElementById('reader-title').textContent = `${serie} · ${name}`;
  document.getElementById('back-to-serie').setAttribute(
    'href',
    `/serie/${encodeURIComponent(serie)}`
  );

  let comics;
  try {
    comics = await api.getJSON(
      `/api/series/${encodeURIComponent(serie)}/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`
    );
  } catch (e) {
    if (e && e.status === 404) {
      container.textContent = 'Ce comics est introuvable.';
      emitError('not_found');
    } else {
      container.textContent = `Erreur : ${e.message}`;
      emitError('fetch_failed');
    }
    return;
  }

  state.pages = comics.pages;
  let overlayOpen = false;

  // --- Prefetch --------------------------------------------------------
  function prefetch(i) {
    if (i < 0 || i >= state.pages.length) return;
    const p = state.pages[i];
    if (p.type === 'image') {
      const img = new Image();
      img.src = api.mediaUrl(serie, folder, p.file);
    }
  }

  // --- Rendu de la page courante (mode classic) ------------------------
  function render() {
    const i = state.index;
    const p = state.pages[i];
    if (!p) return;

    container.innerHTML = '';
    container.classList.remove('clickable');

    if (p.type === 'image') {
      const img = document.createElement('img');
      img.src = api.mediaUrl(serie, folder, p.file);
      img.alt = `Page ${p.num}`;
      container.appendChild(img);
      container.classList.add('clickable');
    } else if (p.type === 'video') {
      const video = document.createElement('video');
      video.src = api.mediaUrl(serie, folder, p.file);
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      container.appendChild(video);

      // V1.4 — Restauration currentTime si sauvegardé
      if (state.currentVideoTime != null) {
        const t = state.currentVideoTime;
        const restore = () => {
          try { video.currentTime = t; } catch { /* ignore */ }
          state.currentVideoTime = null;
        };
        if (video.readyState >= 1) restore();
        else video.addEventListener('loadedmetadata', restore, { once: true });
      }
    }

    indicator.textContent = `Page ${i + 1} / ${state.pages.length}`;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = false;
    prefetch(i + 1);
  }

  function goTo(i) {
    if (i < 0 || i >= state.pages.length) return;
    if (overlayOpen) return;
    state.index = i;
    render();
  }

  function goNext() {
    if (overlayOpen) return;
    if (state.index === state.pages.length - 1) {
      showEndOverlay();
      return;
    }
    goTo(state.index + 1);
  }

  function goPrev() {
    if (overlayOpen) return;
    goTo(state.index - 1);
  }

  // --- Suggestions (inchangé) -----------------------------------------
  function renderSuggestion(s) {
    const link =
      '/reader/' + encodeURIComponent(serie) + '/' +
      encodeURIComponent(s.folder) + '/' + encodeURIComponent(s.name);
    const coverSrc = s.cover
      ? api.mediaUrl(serie, s.folder, s.cover)
      : api.placeholder();
    const lock = api.lockBadge(s.adminOnly === true);
    const pageWord = s.pageCount > 1 ? 'pages' : 'page';
    return (
      '<li class="card">' +
      '  <a href="' + link + '">' +
      '    <img class="thumb" src="' + coverSrc + '" alt="" loading="lazy">' +
      '    <div class="meta">' +
      '      <h3>' + api.escapeHtml(s.name) + lock + '</h3>' +
      '      <p>' + s.pageCount + ' ' + pageWord + '</p>' +
      '    </div>' +
      '  </a>' +
      '</li>'
    );
  }

  function renderEmptySlot() {
    return (
      '<li class="card card-empty" aria-hidden="true">' +
      '  <div class="thumb thumb-empty"></div>' +
      '  <div class="meta"><h3>&nbsp;</h3><p>&nbsp;</p></div>' +
      '</li>'
    );
  }

  async function showEndOverlay() {
    overlayOpen = true;
    overlay.hidden = false;
    backMenu.setAttribute('href', `/serie/${encodeURIComponent(serie)}`);

    try {
      const data = await api.getJSON(
        `/api/series/${encodeURIComponent(serie)}/${encodeURIComponent(folder)}/${encodeURIComponent(name)}/suggestions`
      );
      const sugg = data.suggestions || [];
      if (sugg.length === 0) {
        suggestionsEl.innerHTML =
          '<li class="suggestions-empty">Aucun autre comics à proposer.</li>';
      } else {
        const rendered = sugg.map(renderSuggestion);
        const missing = Math.max(0, 6 - sugg.length);
        for (let i = 0; i < missing; i++) rendered.push(renderEmptySlot());
        suggestionsEl.innerHTML = rendered.join('');
      }
    } catch (e) {
      suggestionsEl.innerHTML =
        '<li class="suggestions-empty">Erreur : ' + api.escapeHtml(e.message) + '</li>';
    }
    backMenu.focus();
  }

  function closeEndOverlay() {
    overlayOpen = false;
    overlay.hidden = true;
  }

  // --- Événements locaux ----------------------------------------------

  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  closeOverlay.addEventListener('click', closeEndOverlay);

  container.addEventListener('click', (ev) => {
    if (state.mode === 'manwa') return;
    const target = ev.target;
    if (target.tagName === 'VIDEO') return;
    const rect = container.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    if (x < rect.width / 2) goPrev();
    else goNext();
  });

  // --- V1.4 : événements inter-lecteurs -------------------------------

  // manwa.js a atteint la sentinelle de fin
  window.addEventListener('reader:end-reached', () => {
    if (!overlayOpen) showEndOverlay();
  });

  // Retour en classic : re-synchroniser sur state.index
  window.addEventListener('reader:mode-change', (ev) => {
    const newMode = ev.detail && ev.detail.mode;
    if (newMode === 'classic') {
      // render() lit state.index et restaure currentVideoTime si vidéo
      render();
    }
  });

  // --- Clavier (désactivé en mode manwa sauf Échap) -------------------
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }

    if (overlayOpen) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeEndOverlay();
      }
      return;
    }

    if (state.mode === 'manwa') {
      // En manwa : seul Échap est géré (retour série)
      if (ev.key === 'Escape') {
        ev.preventDefault();
        window.location.href = `/serie/${encodeURIComponent(serie)}`;
      }
      return;
    }

    switch (ev.key) {
      case 'ArrowLeft':
        ev.preventDefault(); goPrev(); break;
      case 'ArrowRight':
      case ' ':
        ev.preventDefault(); goNext(); break;
      case 'Escape':
        ev.preventDefault();
        window.location.href = `/serie/${encodeURIComponent(serie)}`;
        break;
    }
  });

  // --- Init -----------------------------------------------------------
  render();

  // V1.4 — Notifier manwa.js que les pages sont prêtes
  window.dispatchEvent(new CustomEvent('reader:ready'));
});