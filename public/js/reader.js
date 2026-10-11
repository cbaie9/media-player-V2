'use strict';

/**
 * reader.js — page lecteur (V1.2).
 *
 * V1.2 :
 *   - 6 suggestions (au lieu de 3) — le serveur renvoie déjà count=6
 *   - 🔒 sur les suggestions admin-only (admin uniquement)
 *   - Gestion explicite du 404 (comics admin-only ouvert par un reader)
 *   - Emplacements vides affichés si < 6 suggestions disponibles
 */
document.addEventListener('DOMContentLoaded', async () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // /reader/:serie/:folder/:name
  const serie = decodeURIComponent(parts[1] || '');
  const folder = decodeURIComponent(parts[2] || '');
  const name = decodeURIComponent(parts[3] || '');

  if (!serie || !folder || !name) {
    window.location.href = '/';
    return;
  }

  // V1.2 — Attendre la résolution du rôle (badge 🔒 sur les suggestions)
  if (window.__meReady) {
    try {
      await window.__meReady;
    } catch {
      return;
    }
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
    // V1.2 — 404 : comics admin-only ouvert par un reader, ou URL invalide.
    if (e && e.status === 404) {
      container.textContent = 'Ce comics est introuvable.';
    } else {
      container.textContent = `Erreur : ${e.message}`;
    }
    return;
  }

  const pages = comics.pages;
  let index = 0;
  let overlayOpen = false;

  // Préchargement de la page suivante
  function prefetch(i) {
    if (i < 0 || i >= pages.length) return;
    const p = pages[i];
    if (p.type === 'image') {
      const img = new Image();
      img.src = api.mediaUrl(serie, folder, p.file);
    }
  }

  function render() {
    const p = pages[index];
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
    }

    indicator.textContent = `Page ${index + 1} / ${pages.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = false;

    prefetch(index + 1);
  }

  function goTo(i) {
    if (i < 0 || i >= pages.length) return;
    if (overlayOpen) return;
    index = i;
    render();
  }

  function goNext() {
    if (overlayOpen) return;
    if (index === pages.length - 1) {
      showEndOverlay();
      return;
    }
    goTo(index + 1);
  }

  function goPrev() {
    if (overlayOpen) return;
    goTo(index - 1);
  }

  /**
   * V1.2 — Rend une suggestion.
   *
   * La suggestion porte `folder`, `adminOnly`, `pageCount`, `cover`,
   * `hasVideo`. Le 🔒 est affiché si admin et adminOnly.
   *
   * Le lien utilise le folder réel de la suggestion.
   */
  function renderSuggestion(s) {
    const link =
      '/reader/' +
      encodeURIComponent(serie) +
      '/' +
      encodeURIComponent(s.folder) +
      '/' +
      encodeURIComponent(s.name);

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

  /**
   * V1.2 — Rend un emplacement vide (slot vide quand < 6 suggestions).
   */
  function renderEmptySlot() {
    return (
      '<li class="card card-empty" aria-hidden="true">' +
      '  <div class="thumb thumb-empty"></div>' +
      '  <div class="meta">' +
      '    <h3>&nbsp;</h3>' +
      '    <p>&nbsp;</p>' +
      '  </div>' +
      '</li>'
    );
  }

  /**
   * Affiche l'overlay de fin de comics.
   *
   * V1.2 :
   *   - 6 suggestions attendues
   *   - slots vides comblés jusqu'à 6
   *   - message dédié si 0 suggestion
   */
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
        for (let i = 0; i < missing; i++) {
          rendered.push(renderEmptySlot());
        }
        suggestionsEl.innerHTML = rendered.join('');
      }
    } catch (e) {
      suggestionsEl.innerHTML =
        '<li class="suggestions-empty">Erreur : ' +
        api.escapeHtml(e.message) +
        '</li>';
    }

    backMenu.focus();
  }

  function closeEndOverlay() {
    overlayOpen = false;
    overlay.hidden = true;
  }

  // --- Événements --------------------------------------------------------

  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  closeOverlay.addEventListener('click', closeEndOverlay);

  container.addEventListener('click', (ev) => {
    const target = ev.target;
    if (target.tagName === 'VIDEO') return;
    const rect = container.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    if (x < rect.width / 2) goPrev();
    else goNext();
  });

  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (
      t &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    ) {
      return;
    }

    if (overlayOpen) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeEndOverlay();
      }
      return;
    }

    switch (ev.key) {
      case 'ArrowLeft':
        ev.preventDefault();
        goPrev();
        break;
      case 'ArrowRight':
      case ' ':
        ev.preventDefault();
        goNext();
        break;
      case 'Escape':
        ev.preventDefault();
        window.location.href = `/serie/${encodeURIComponent(serie)}`;
        break;
    }
  });

  render();
});