'use strict';

/**
 * header.js — factorisation du header (V1.1, E4).
 *
 * Responsabilités :
 *  - Charger GET /api/me et afficher le badge de rôle (D1-D5).
 *  - Rediriger vers /login si /api/me échoue (D6).
 *  - Gérer la déconnexion (bouton #logout).
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

  /**
   * Redirige vers /login sans créer de boucle si on y est déjà passé
   * dans les 5 dernières secondes.
   *
   * V1.1 — F7 : on pose un flag dans sessionStorage AVANT la redirection,
   * pour permettre aux tests E2E de vérifier la tentative même si la
   * navigation est très rapide ou rebondit (session encore valide → /).
   */
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

    // Flag observable par les tests (F7)
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
    if (!logoutBtn) return;

    try {
      const me = await api.getJSON('/api/me');
      insertRoleBadge(logoutBtn, me.role || me.username || 'unknown');
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[header] /api/me failed:', err && err.message);
      }
      redirectToLogin();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();