'use strict';

/**
 * series.js — page « Séries » (V1.2).
 *
 * V1.2 :
 *   - Attend window.__meReady (rôle connu) avant de rendre, pour pouvoir
 *     afficher le 🔒 sur les séries admin-only (admin uniquement).
 *   - Affiche le 🔒 sur la carte d'une série si adminOnly && isAdmin().
 */
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('series-list');
  const empty = document.getElementById('series-empty');

  // V1.2 — Attendre la résolution du rôle (posée par header.js)
  if (window.__meReady) {
    try {
      await window.__meReady;
    } catch {
      // header.js gère déjà la redirection ; on s'arrête proprement.
      return;
    }
  }

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
      // V1.2 — 🔒 si admin et série admin-only
      const lock = api.lockBadge(s.adminOnly === true);
      const meta = s.comicsCount + ' comics · ' + s.imgCount + ' images';

      return [
        '<li class="card">',
        '  <a href="' + url + '">',
        '    <img class="thumb" src="' + img + '" alt="" loading="lazy">',
        '    <div class="meta">',
        '      <h2>' + name + lock + '</h2>',
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