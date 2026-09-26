'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { suggestForComics } = require('../suggest');

/**
 * Routeur API : /api/series, /api/series/:serie, /api/series/:serie/:folder/:name,
 * /api/series/:serie/:folder/:name/suggestions, /api/rescan.
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

  // GET /api/series
  router.get('/series', (req, res) => {
    if (store.error === 'root_dir_unavailable') {
      return res.status(500).json({
        error: 'root_dir_unavailable',
        message: 'ROOT_DIR inaccessible',
      });
    }
    return res.json({ series: store.listSeries() });
  });

  // GET /api/series/:serie
  router.get('/series/:serie', (req, res) => {
    const { serie } = req.params;
    if (!/^[a-z0-9_-]+$/.test(serie)) {
      return res.status(404).json({ error: 'serie_not_found' });
    }
    const data = store.getSerie(serie);
    if (!data) return res.status(404).json({ error: 'serie_not_found' });
    return res.json(data);
  });

  // GET /api/series/:serie/:folder/:name
  router.get('/series/:serie/:folder/:name', (req, res) => {
    const { serie, folder, name } = req.params;
    if (!/^[a-z0-9_-]+$/.test(serie)) {
      return res.status(404).json({ error: 'serie_not_found' });
    }
    const data = store.getComics(serie, folder, name);
    if (!data) return res.status(404).json({ error: 'comics_not_found' });
    return res.json(data);
  });

  // GET /api/series/:serie/:folder/:name/suggestions
  // Retourne { suggestions: [{ name, pageCount, cover }, ...] }
  // où `cover` est le premier fichier du comics (image ou video), ou null.
  router.get('/series/:serie/:folder/:name/suggestions', (req, res) => {
    const { serie, folder, name } = req.params;
    if (!/^[a-z0-9_-]+$/.test(serie)) {
      return res.status(404).json({ error: 'serie_not_found' });
    }
    const comics = store.getComics(serie, folder, name);
    if (!comics) return res.status(404).json({ error: 'comics_not_found' });

    const suggestions = suggestForComics({
      series: store.series,
      serieName: serie,
      folder,
      currentName: name,
      count: 3,
    });
    return res.json({ suggestions });
  });

  // POST /api/rescan (admin)
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