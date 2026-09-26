'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const serie = decodeURIComponent(parts[1] || '');
  if (!serie) {
    window.location.href = '/';
    return;
  }

  document.getElementById('serie-title').textContent = serie;
  document.title = serie + ' · Media Player V2';

  const listEl = document.getElementById('comics-list');
  const tabs = document.querySelectorAll('[role="tab"]');

  let data;
  try {
    data = await api.getJSON('/api/series/' + encodeURIComponent(serie));
  } catch (e) {
    listEl.innerHTML = '<li>Erreur : ' + api.escapeHtml(e.message) + '</li>';
    return;
  }

  function render(folder) {
    const items = data[folder] || [];
    if (items.length === 0) {
      listEl.innerHTML = '<li>Aucun élément dans « ' + folder + ' ».</li>';
      return;
    }

    const html = items.map((c) => {
      const cover = c.cover
        ? api.mediaUrl(serie, folder, c.cover)
        : api.placeholder();
      const link =
        '/reader/' +
        encodeURIComponent(serie) +
        '/' +
        folder +
        '/' +
        encodeURIComponent(c.name);
      const pageWord = c.pageCount > 1 ? 'pages' : 'page';

      return [
        '<li class="card">',
        '  <a href="' + link + '">',
        '    <img class="thumb" src="' + api.placeholder() + '"' +
        ' data-src="' + cover + '" alt="" loading="lazy">',
        '    <div class="meta">',
        '      <h3>' + api.escapeHtml(c.name) + '</h3>',
        '      <p>' + c.pageCount + ' ' + pageWord + '</p>',
        '    </div>',
        '  </a>',
        '</li>',
      ].join('\n');
    });

    listEl.innerHTML = html.join('\n');

    if (window.lazyObserve) window.lazyObserve(listEl);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      render(tab.dataset.tab);
    });
  });

  render('comics');

  const back = document.getElementById('back-to-serie');
  if (back) back.setAttribute('href', '/serie/' + encodeURIComponent(serie));
});