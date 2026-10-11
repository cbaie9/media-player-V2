'use strict';

(function () {
  /**
   * V1.2 — Rôle de l'utilisateur courant.
   * Initialisé à null tant que header.js n'a pas résolu /api/me.
   * @type {'reader'|'admin'|null}
   */
  let currentRole = null;

  const api = {
    async getJSON(url) {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('unauthorized');
      }
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error || 'not_found');
        err.status = 404;
        throw err;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error || 'HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },

    async postJSON(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('unauthorized');
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || 'HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },

    async postForm(url, data) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
      });
    },

    async logout() {
      try {
        await fetch('/logout', {
          method: 'POST',
          credentials: 'same-origin',
        });
      } catch (e) {
        /* ignore */
      }
      window.location.href = '/login';
    },

    escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, (c) => {
        if (c === '&') return '&amp;';
        if (c === '<') return '&lt;';
        if (c === '>') return '&gt;';
        if (c === '"') return '&quot;';
        return '&#39;';
      });
    },

    mediaUrl(serie, folder, file) {
      return (
        '/media/' +
        encodeURIComponent(serie) +
        '/' +
        folder +
        '/' +
        encodeURIComponent(file)
      );
    },

    /**
     * URL RELATIVE (clé de cache pour thumb.js, cf. B4).
     * Exemple : "serie_a/comics/comics_a-0003.mp4"
     *
     * V1.2 — le folder peut contenir `_admin`, ce qui est voulu :
     * les vignettes des comics admin sont distinctes des vignettes
     * des comics normaux (ce sont 2 entités différentes).
     */
    mediaRelKey(serie, folder, file) {
      return (
        String(serie) + '/' + String(folder) + '/' + String(file)
      );
    },

    /**
     * Placeholder SVG générique (icône ?).
     */
    placeholder() {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" ' +
        'viewBox="0 0 200 280">' +
        '<rect width="100%" height="100%" fill="#2a2a2e"/>' +
        '<text x="50%" y="50%" fill="#8a8a92" font-family="system-ui" ' +
        'font-size="48" text-anchor="middle" dominant-baseline="central">?</text>' +
        '</svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    },

    /**
     * V1.1 — placeholder SVG avec icône ▶, utilisé pour les vignettes
     * vidéo dont l'extraction échoue.
     */
    videoPlaceholder() {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" ' +
        'viewBox="0 0 200 280">' +
        '<rect width="100%" height="100%" fill="#2a2a2e"/>' +
        '<circle cx="100" cy="120" r="36" fill="rgba(255,255,255,0.12)"/>' +
        '<polygon points="88,100 88,140 122,120" fill="#e8e8ec"/>' +
        '<text x="50%" y="200" fill="#8a8a92" font-family="system-ui" ' +
        'font-size="14" text-anchor="middle">vidéo</text>' +
        '</svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    },

    /**
     * V1.1 — récupère le profil utilisateur (username + role).
     */
    getMe() {
      return this.getJSON('/api/me');
    },

    bindLogout() {
      const btn = document.getElementById('logout');
      if (btn) btn.addEventListener('click', () => api.logout());
    },

    // ---------------------------------------------------------------------
    // V1.2 — Helpers rôle / badge 🔒
    // ---------------------------------------------------------------------

    /**
     * Rôle courant, ou null si pas encore résolu.
     * @returns {'reader'|'admin'|null}
     */
    getRole() {
      return currentRole;
    },

    /**
     * V1.2 — Fixe le rôle courant. Appelé par header.js après /api/me.
     * @param {'reader'|'admin'} role
     */
    setRole(role) {
      currentRole = role === 'admin' ? 'admin' : 'reader';
    },

    /**
     * V1.2 — L'utilisateur courant est-il admin ?
     * @returns {boolean}
     */
    isAdmin() {
      return currentRole === 'admin';
    },

    /**
     * V1.2 — Retourne un fragment HTML pour le badge 🔒.
     *
     * Règles :
     *   - Admin ET item adminOnly → ' 🔒'
     *   - Sinon → ''
     *
     * Le badge est purement visuel, jamais utilisé dans les noms de
     * fichiers, les URLs ou les clés de cache.
     *
     * @param {boolean} adminOnly
     * @returns {string}
     */
    lockBadge(adminOnly) {
      if (!adminOnly) return '';
      if (!api.isAdmin()) return '';
      return ' <span class="lock-badge" aria-label="Réservé aux admins" title="Réservé aux admins">🔒</span>';
    },
  };

  window.api = api;
  document.addEventListener('DOMContentLoaded', () => api.bindLogout());
})();