'use strict';

/**
 * header.js — factorisation du header (V1.1, E4).
 *
 * Responsabilités :
 *  - Charger GET /api/me et afficher le badge de rôle (D1-D5).
 *  - Rediriger vers /login si /api/me échoue (D6).
 *  - Gérer la déconnexion (bouton #logout).
 *  - V1.2 : exposer le rôle courant via api.setRole().
 *  - V1.5 : injecter un lien « Scrapper » dans le topbar si le module
 *    est activé et si le rôle est autorisé (GET /api/scrapper/config).
 *
 * Ordre de chargement : api.js DOIT être chargé avant header.js.
 * `window.__meReady` est une promesse résolue quand /api/me a répondu.
 */
(function () {
  const SESSION_KEY = 'header_last_redirect';
  const FLAG_KEY = '__headerRedirectAttempted';

  function sanitizeRoleClass(role) {
    return String(role || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
  }

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

  /**
   * V1.5 — Injecte un lien vers /scrapper dans le topbar, à gauche du
   * badge de rôle (ou du bouton logout si le badge n'existe pas).
   *
   * Le lien reste caché (`hidden`) tant que /api/scrapper/config n'a
   * pas confirmé que le module est activé ET que le rôle est autorisé.
   * Un échec de la requête est silencieux (le module n'est juste pas
   * proposé, comportement V1.4 inchangé).
   *
   * @param {HTMLElement} logoutBtn
   * @param {string} role
   */
  function insertScrapperLink(logoutBtn, role) {
    if (document.getElementById('nav-scrapper')) return;

    const link = document.createElement('a');
    link.id = 'nav-scrapper';
    link.href = '/scrapper';
    link.textContent = 'Scrapper';
    link.className = 'nav-link';
    link.hidden = true;
    link.setAttribute('aria-label', 'Ouvrir le module Scrapper');

    // Insertion avant le badge de rôle (ordre visuel : nav → badge → logout)
    const badge = document.getElementById('role-badge');
    const anchor = badge || logoutBtn;
    anchor.parentNode.insertBefore(link, anchor);

    // Vérification asynchrone : le lien n'apparaît que si autorisé.
    api
      .getJSON('/api/scrapper/config')
      .then(function (cfg) {
        if (!cfg || !cfg.enabled) return;
        const roles = Array.isArray(cfg.roles) ? cfg.roles : ['admin'];
        if (roles.indexOf(role) !== -1) {
          link.hidden = false;
        }
      })
      .catch(function () {
        /* silencieux : module non configuré ou endpoint absent */
      });
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
      /* ignore */
    }
    window.__headerRedirectAttempted = true;

    try {
      sessionStorage.setItem(SESSION_KEY, String(now));
    } catch {
      /* ignore */
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
        // V1.5 — Décision purement client, lien révélé seulement si autorisé.
        insertScrapperLink(logoutBtn, role);
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