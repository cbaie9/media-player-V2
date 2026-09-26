'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // /reader/:serie/:folder/:name
  const serie = decodeURIComponent(parts[1] || '');
  const folder = parts[2] || '';
  const name = decodeURIComponent(parts[3] || '');

  if (!serie || !folder || !name) {
    window.location.href = '/';
    return;
  }

  const container = document.getElementById('page-container');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const indicator = document.getElementById('page-indicator');
  const overlay = document.getElementById('end-overlay');
  const suggestionsEl = document.getElementById('suggestions');
  const backMenu = document.getElementById('back-menu');
  const closeOverlay = document.getElementById('close-overlay');

  document.getElementById('reader-title').textContent = serie + ' · ' + name;
  document
    .getElementById('back-to-serie')
    .setAttribute('href', '/serie/' + encodeURIComponent(serie));

  let comics;
  try {
    comics = await api.getJSON(
      '/api/series/' +
        encodeURIComponent(serie) +
        '/' +
        folder +
        '/' +
        encodeURIComponent(name)
    );
  } catch (e) {
    container.textContent = 'Erreur : ' + e.message;
    return;
  }

  const pages = comics.pages;
  let index = 0;
  let overlayOpen = false;

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
      img.alt = 'Page ' + p.num;
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

    indicator.textContent = 'Page ' + (index + 1) + ' / ' + pages.length;
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

  async function showEndOverlay() {
    overlayOpen = true;
    overlay.hidden = false;

    backMenu.setAttribute('href', '/serie/' + encodeURIComponent(serie));

    try {
      const data = await api.getJSON(
        '/api/series/' +
          encodeURIComponent(serie) +
          '/' +
          folder +
          '/' +
          encodeURIComponent(name) +
          '/suggestions'
      );
      const sugg = data.suggestions || [];

      if (sugg.length === 0) {
        suggestionsEl.innerHTML = '<li>Aucune autre suggestion.</li>';
      } else {
        const html = sugg.map((s) => {
          const link =
            '/reader/' +
            encodeURIComponent(serie) +
            '/' +
            folder +
            '/' +
            encodeURIComponent(s.name);
          const pageWord = s.pageCount > 1 ? 'pages' : 'page';

          return [
            '<li class="card">',
            '  <a href="' + link + '">',
            '    <img class="thumb" src="' + api.placeholder() + '"' +
            ' alt="" loading="lazy">',
            '    <div class="meta">',
            '      <h3>' + api.escapeHtml(s.name) + '</h3>',
            '      <p>' + s.pageCount + ' ' + pageWord + '</p>',
            '    </div>',
            '  </a>',
            '</li>',
          ].join('\n');
        });
        suggestionsEl.innerHTML = html.join('\n');
      }
    } catch (e) {
      suggestionsEl.innerHTML =
        '<li>Erreur : ' + api.escapeHtml(e.message) + '</li>';
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
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable)
    )
      return;

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
        window.location.href = '/serie/' + encodeURIComponent(serie);
        break;
    }
  });

  render();
});