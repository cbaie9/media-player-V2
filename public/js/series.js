'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('series-list');
  const empty = document.getElementById('series-empty');

  try {
    const data = await api.getJSON('/api/series');

    if (!data.series || data.series.length === 0) {
      empty.hidden = false;
      return;
    }

    const items = data.series.map((s) => {
      const url = '/serie/' + encodeURIComponent(s.name);
      const img = api.placeholder();
      const name = api.escapeHtml(s.name);
      const meta = s.comicsCount + ' comics · ' + s.imgCount + ' images';

      return [
        '<li class="card">',
        '  <a href="' + url + '">',
        '    <img class="thumb" src="' + img + '" alt="" loading="lazy">',
        '    <div class="meta">',
        '      <h2>' + name + '</h2>',
        '      <p>' + meta + '</p>',
        '    </div>',
        '  </a>',
        '</li>',
      ].join('\n');
    });

    list.innerHTML = items.join('\n');
  } catch (e) {
    empty.textContent = 'Erreur : ' + e.message;
    empty.hidden = false;
  }
});