'use strict';

/**
 * series.js — page « Séries » (V1.2 → V1.5.3).
 *
 * V1.2 :
 *   - Attend window.__meReady (rôle connu) avant de rendre, pour pouvoir
 *     afficher le 🔒 sur les séries admin-only (admin uniquement).
 *   - Affiche le 🔒 sur la carte d'une série si adminOnly && isAdmin().
 *
 * V1.5.3 :
 *   - Utilise la cover de série exposée par l'API (`s.cover`) si
 *     présente, via `GET /media/:serie/cover`.
 *   - Fallback automatique sur `api.placeholder()` :
 *       * si `s.cover` est null (aucun fichier au scan)
 *       * si l'image échoue à charger (fichier supprimé après le scan,
 *         problème disque, etc.) — via un handler `error` one-shot.
 *   - Les cartes sont construites en DOM (pas d'innerHTML de chaînes
 *     contenant des URLs), ce qui évite toute injection et facilite
 *     la pose des handlers `error`.
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

    const placeholder = api.placeholder();

    const items = data.series.map((s) => {
      const url = '/serie/' + encodeURIComponent(s.name);
      const name = api.escapeHtml(s.name);
      // V1.2 — 🔒 si admin et série admin-only
      const lock = api.lockBadge(s.adminOnly === true);
      const meta = s.comicsCount + ' comics · ' + s.imgCount + ' images';

      const li = document.createElement('li');
      li.className = 'card';

      const a = document.createElement('a');
      a.href = url;

      const img = document.createElement('img');
      img.className = 'thumb';
      img.alt = '';
      img.loading = 'lazy';
      if (s.cover) {
        img.src = '/media/' + encodeURIComponent(s.name) + '/cover';
        // Si l'image échoue, on bascule sur le placeholder.
        // `once: true` évite une boucle si le placeholder échouait lui-même
        // (cas théorique : data URI malformé).
        img.addEventListener(
          'error',
          () => { img.src = placeholder; },
          { once: true }
        );
      } else {
        img.src = placeholder;
      }

      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta';
      metaDiv.innerHTML =
        '<h2>' + name + lock + '</h2>' +
        '<p>' + meta + '</p>';

      a.appendChild(img);
      a.appendChild(metaDiv);
      li.appendChild(a);
      return li;
    });

    list.replaceChildren(...items);
  } catch (e) {
    empty.textContent = 'Erreur : ' + e.message;
    empty.hidden = false;
  }
});