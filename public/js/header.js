'use strict';

/**
 * header.js — factorisation du header (V1.1, E4).
 *
 * Responsabilités :
 *  - Charger GET /api/me et afficher le badge de rôle (D1-D5).
 *  - Rediriger vers /login si /api/me échoue (D6).
 *  - Gérer la déconnexion (bouton #logout).
 *  - V1.2 : exposer le rôle courant via api.setRole() pour que les
 *    autres scripts (serie.js, series.js, reader.js) puissent décider
 *    d'afficher ou non les badges 🔒.
 *
 * Ordre de chargement : api.js DOIT être chargé avant header.js.
 * Les scripts de page (serie.js, etc.) attendent DOMContentLoaded et
 * s'exécutent après header.js (même événement, ordre d'ajout préservé).
 * Pour être robuste, on expose une promesse `window.__meReady` que les
 * pages peuvent attendre.
 */
(function () {
  const SESSION_KEY = 'header_last_redirect';
  const FLAG_KEY = '__headerRedirectAttempted';

  function insertRoleBadge(logoutBtn, role) {
    if (document.getElementById('role-badge')) return;

    const badge = document.createElement('span');
    badge.id = 'role-badge';
    badge.className = 'role-badge role-badge--' + sanitizeRoleClass(role);
    badge.textContent = role;
    badge.setAttribute('aria-label', 'Rôle : ' + role);
    badge.title = 'Rôle : ' + role;

    logoutBtn.parentNode.insertBefore(badge, logoutBtn);
  }

  function sanitizeRoleClass(role) {
    return String(role || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
  }

  function redirectToLogin() {
    if (window.location.pathname === '/login') return;

    const now = Date.now();
    let last = 0;
    try {
      last = parseInt(sessionStorage.getItem(SESSION_KEY) || '0', 10);
    } catch {
      last = 0;
    }
    if (now - last < 5000) return; // anti-boucle

    try {
      sessionStorage.setItem(FLAG_KEY, String(now));
    } catch {
      // ignore
    }
    window.__headerRedirectAttempted = true;

    try {
      sessionStorage.setItem(SESSION_KEY, String(now));
    } catch {
      // ignore
    }

    window.location.replace('/login');
  }

  async function init() {
    const logoutBtn = document.getElementById('logout');
    if (!logoutBtn) {
      // Page sans bouton logout (ex: index.html) : on résout quand même
      // __meReady pour ne pas bloquer les scripts qui l'attendent.
      window.__meReady = Promise.resolve(null);
      return;
    }

    const p = (async () => {
      try {
        const me = await api.getJSON('/api/me');
        const role = me.role || me.username || 'unknown';
        api.setRole(role);
        insertRoleBadge(logoutBtn, role);
        return me;
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[header] /api/me failed:', err && err.message);
        }
        redirectToLogin();
        return null;
      }
    })();

    window.__meReady = p;
  }

  document.addEventListener('DOMContentLoaded', init);
})();