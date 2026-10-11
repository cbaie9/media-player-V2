'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { suggestForComics } = require('../suggest');

/**
 * Routeur API : /api/series, /api/series/:serie, /api/series/:serie/:folder/:name,
 * /api/series/:serie/:folder/:name/suggestions, /api/rescan, /api/me.
 *
 * V1.2 :
 *   - Le rôle de l'utilisateur (session) est passé aux helpers du store
 *     et au moteur de suggestions.
 *   - `folder` accepte 4 valeurs : 'comics', 'comics_admin', 'img', 'img_admin'.
 *   - Un reader qui demande une ressource admin-only reçoit un 404
 *     (comme si elle n'existait pas).
 *   - Les suggestions passent de 3 à 6.
 *
 * @param {object} params
 * @param {import('../store').Store} params.store
 * @param {object} params.logger
 * @returns {import('express').Router}
 */
function buildApiRouter({ store, logger }) {
  const router = express.Router();

  // Toutes les routes API exigent une session
  router.use(requireAuth());

  // Dossiers valides (V1.2)
  const VALID_FOLDERS = new Set([
    'comics',
    'comics_admin',
    'img',
    'img_admin',
  ]);

  const SERIE_RE = /^[a-z0-9_-]+$/;

  /**
   * Récupère le rôle depuis la session, avec fallback safe.
   * @param {import('express').Request} req
   * @returns {'reader'|'admin'}
   */
  function roleOf(req) {
    const user = (req.session && req.session.user) || null;
    if (user && user.role === 'admin') return 'admin';
    return 'reader';
  }

  // ---------------------------------------------------------------------
  // GET /api/me
  // Retourne { username, role } depuis la session.
  // ---------------------------------------------------------------------
  router.get('/me', (req, res) => {
    const user = (req.session && req.session.user) || null;
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const username = user.username;
    const role = user.role || username;

    if (logger) {
      logger.info('me_served', { username, role });
    }

    return res.json({ username, role });
  });

  // ---------------------------------------------------------------------
  // GET /api/series
  // V1.2 : filtré par rôle (une série admin-only n'apparaît pas au reader).
  // ---------------------------------------------------------------------
  router.get('/series', (req, res) => {
    if (store.error === 'root_dir_unavailable') {
      return res.status(500).json({
        error: 'root_dir_unavailable',
        message: 'ROOT_DIR inaccessible',
      });
    }
    const role = roleOf(req);
    return res.json({ series: store.listSeries(role) });
  });

  // ---------------------------------------------------------------------
  // GET /api/series/:serie
  // V1.2 : 404 pour un reader si la série est admin-only ;
  //        les comics/img admin-only sont exclus de la réponse.
  // ---------------------------------------------------------------------
  router.get('/series/:serie', (req, res) => {
    const { serie } = req.params;
    if (!SERIE_RE.test(serie)) {
      return res.status(404).json({ error: 'serie_not_found' });
    }
    const role = roleOf(req);
    const data = store.getSerie(serie, role);
    if (!data) return res.status(404).json({ error: 'serie_not_found' });
    return res.json(data);
  });

  // ---------------------------------------------------------------------
  // GET /api/series/:serie/:folder/:name
  // V1.2 : folder ∈ 4 valeurs ; 404 si admin-only et role reader.
  // ---------------------------------------------------------------------
  router.get('/series/:serie/:folder/:name', (req, res) => {
    const { serie, folder, name } = req.params;
    if (!SERIE_RE.test(serie)) {
      return res.status(404).json({ error: 'serie_not_found' });
    }
    if (!VALID_FOLDERS.has(folder)) {
      return res.status(404).json({ error: 'comics_not_found' });
    }

    const role = roleOf(req);
    const data = store.getComics(serie, folder, name, role);
    if (!data) return res.status(404).json({ error: 'comics_not_found' });
    return res.json(data);
  });

  // ---------------------------------------------------------------------
  // GET /api/series/:serie/:folder/:name/suggestions
  // Retourne { suggestions: [{ name, folder, adminOnly, pageCount, cover, hasVideo }, ...] }
  //
  // V1.2 :
  //   - count = 6 (au lieu de 3)
  //   - cross-dossier admin : pour un admin, les dossiers normal et admin
  //     de la même base se recommandent entre eux
  //   - pour un reader, seuls les comics non-admin sont proposés
  // ---------------------------------------------------------------------
  router.get('/series/:serie/:folder/:name/suggestions', (req, res) => {
    const { serie, folder, name } = req.params;
    if (!SERIE_RE.test(serie)) {
      return res.status(404).json({ error: 'serie_not_found' });
    }
    if (!VALID_FOLDERS.has(folder)) {
      return res.status(404).json({ error: 'comics_not_found' });
    }

    const role = roleOf(req);
    const comics = store.getComics(serie, folder, name, role);
    if (!comics) return res.status(404).json({ error: 'comics_not_found' });

    const suggestions = suggestForComics({
      series: store.series,
      serieName: serie,
      folder,
      currentName: name,
      role,
      count: 6,
    });
    return res.json({ suggestions });
  });

  // ---------------------------------------------------------------------
  // POST /api/rescan (admin)
  // ---------------------------------------------------------------------
  router.post('/rescan', requireAdmin(), (req, res) => {
    const r = store.rescan();
    if (logger) {
      logger.info('rescan_requested', { by: req.session.user.username });
    }
    return res.json({
      ok: !r.error,
      seriesCount: r.seriesCount,
      comicsCount: r.comicsCount,
      warnings: r.warningsCount,
      error: r.error || null,
    });
  });

  return router;
}

module.exports = { buildApiRouter };