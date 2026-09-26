'use strict';

(function () {
  const api = {
    async getJSON(url) {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('unauthorized');
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'HTTP ' + res.status);
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
        throw new Error(data.error || 'HTTP ' + res.status);
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

    bindLogout() {
      const btn = document.getElementById('logout');
      if (btn) btn.addEventListener('click', () => api.logout());
    },
  };

  window.api = api;
  document.addEventListener('DOMContentLoaded', () => api.bindLogout());
})();