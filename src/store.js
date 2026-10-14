'use strict';

const path = require('node:path');
const {
  scanRoot,
  writeWarningsLog,
  isAdminFolder,
} = require('./scanner');
const {
  buildCachePayload,
  writeCache,
  readCache,
  peekCacheVersion,
  CACHE_VERSION,
} = require('./cache');

/**
 * Store : encapsule la structure de données du site.
 *
 * Responsabilités :
 *  - Charger depuis le cache si présent et valide (B1)
 *  - Sinon, scanner la racine et écrire le cache (B1)
 *  - Exposer des helpers pour l'API (/api/series, /api/series/:serie, etc.)
 *  - Fournir un `rescan()` pour POST /api/rescan (B2)
 *  - V1.2 : filtrer selon le rôle (reader vs admin)
 *
 * Ne connaît RIEN de HTTP ni de sessions.
 */
class Store {
  /**
   * @param {object} opts
   * @param {string} opts.rootDir       - Chemin absolu de la racine
   * @param {string} opts.cacheFile     - Chemin absolu de cache/scan.json
   * @param {string} opts.warningsFile  - Chemin absolu de logs/scan-warnings.log
   * @param {object} [opts.logger]      - Logger injectable (facultatif)
   */
  constructor({ rootDir, cacheFile, warningsFile, logger }) {
    this.rootDir = path.resolve(rootDir);
    this.cacheFile = cacheFile;
    this.warningsFile = warningsFile;
    this.logger = logger || null;

    /**
     * @type {object} — { serieName: { adminOnly, comics: [], img: [] } }
     * Chaque comics porte : { name, folder, adminOnly, hasVideo, pages }
     */
    this.series = {};

    /** @type {string|null} — 'root_dir_unavailable' si erreur */
    this.error = null;

    /** @type {string|null} */
    this.generatedAt = null;

    /** @type {number} */
    this.lastWarningsCount = 0;
  }

  /**
   * Charge le cache s'il est valide. Retourne true si chargé.
   * @returns {boolean}
   */
  loadFromCache() {
    const cache = readCache(this.cacheFile);

    if (!cache) {
      const found = peekCacheVersion(this.cacheFile);
      if (found !== null && found !== CACHE_VERSION && this.logger) {
        this.logger.info('cache_version_mismatch', {
          found,
          expected: CACHE_VERSION,
        });
      }
      return false;
    }

    if (cache.rootDir !== this.rootDir) {
      if (this.logger) {
        this.logger.info('cache_rootdir_mismatch', {
          cache: cache.rootDir,
          current: this.rootDir,
        });
      }
      return false;
    }

    this.series = cache.series || {};
    this.generatedAt = cache.generatedAt || null;
    this.error = null;
    return true;
  }

  /**
   * Lance un scan complet : met à jour la structure en mémoire,
   * écrit le cache et les warnings (B4).
   *
   * @returns {{ seriesCount, comicsCount, warningsCount, durationMs, error? }}
   */
  rescan() {
    const startedAt = Date.now();

    if (this.logger) this.logger.info('scan_start', { rootDir: this.rootDir });

    const result = scanRoot({ rootDir: this.rootDir });
    const durationMs = Date.now() - startedAt;

    if (result.error) {
      this.series = {};
      this.error = result.error;
      if (this.logger) {
        this.logger.error('root_dir_error', { message: 'unavailable' });
      }
      return {
        seriesCount: 0,
        comicsCount: 0,
        warningsCount: 0,
        durationMs,
        error: result.error,
      };
    }

    this.series = result.series;
    this.error = null;
    this.generatedAt = new Date().toISOString();

    try {
      writeCache(
        this.cacheFile,
        buildCachePayload({
          rootDir: this.rootDir,
          series: this.series,
          now: new Date(),
        })
      );
    } catch (err) {
      if (this.logger) {
        this.logger.error('cache_write_failed', { message: err.message });
      }
    }

    try {
      writeWarningsLog(this.warningsFile, result.warnings);
      this.lastWarningsCount = result.warnings.length;
    } catch (err) {
      if (this.logger) {
        this.logger.error('warnings_write_failed', { message: err.message });
      }
    }

    if (this.logger) {
      this.logger.info('scan_end', {
        seriesCount: result.stats.seriesCount,
        comicsCount: result.stats.comicsCount,
        warnings: result.warnings.length,
        durationMs,
      });
    }

    return {
      seriesCount: result.stats.seriesCount,
      comicsCount: result.stats.comicsCount,
      warningsCount: result.warnings.length,
      durationMs,
    };
  }

  /**
   * Charge depuis le cache, sinon scan (B1).
   */
  init() {
    if (this.loadFromCache()) {
      if (this.logger) {
        this.logger.info('cache_loaded', { path: this.cacheFile });
      }
      return { source: 'cache' };
    }
    const res = this.rescan();
    return { source: 'scan', ...res };
  }

  // -------------------------------------------------------------------------
  // V1.2 — Helpers role-aware
  // -------------------------------------------------------------------------

  /**
   * Un comics est-il visible pour un rôle donné ?
   * @param {{ adminOnly: boolean }} comics
   * @param {'reader'|'admin'} role
   */
  static isVisible(comics, role) {
    if (!comics) return false;
    if (!comics.adminOnly) return true;
    return role === 'admin';
  }

  /**
   * Liste des séries au format /api/series, filtrée par rôle.
   *
   * V1.2 : une série admin-only n'est PAS listée pour un reader.
   * Pour un admin, elle est listée avec `adminOnly: true`.
   *
   * @param {'reader'|'admin'} [role='reader']
   * @returns {Array<{ name, comicsCount, imgCount, adminOnly }>}
   */
  listSeries(role = 'reader') {
    return Object.entries(this.series)
      .filter(([, s]) => {
        if (role === 'admin') return true;
        return !s.adminOnly;
      })
      .map(([name, s]) => {
        const visible = (list) =>
          (list || []).filter((c) => Store.isVisible(c, role));
        return {
          name,
          comicsCount: visible(s.comics).length,
          imgCount: visible(s.img).length,
          adminOnly: s.adminOnly === true,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Détail d'une série : /api/series/:serie
   *
   * V1.2 : filtre les comics/img selon le rôle.
   * Chaque item expose `adminOnly` et `folder`.
   *
   * @param {string} serieName
   * @param {'reader'|'admin'} [role='reader']
   * @returns {object|null}
   */
  getSerie(serieName, role = 'reader') {
    const s = this.series[serieName];
    if (!s) return null;

    // V1.2 : une série admin-only renvoie 404 pour un reader.
    if (role !== 'admin' && s.adminOnly) return null;

    const mapList = (list) =>
      (list || [])
        .filter((c) => Store.isVisible(c, role))
        .map((c) => ({
          name: c.name,
          folder: c.folder,
          adminOnly: c.adminOnly === true,
          pageCount: c.pages.length,
          cover: c.pages.length > 0 ? c.pages[0].file : null,
          hasVideo: c.hasVideo === true,
        }));

    return {
      name: serieName,
      adminOnly: s.adminOnly === true,
      comics: mapList(s.comics),
      img: mapList(s.img),
    };
  }

  /**
   * Détail d'un comics : /api/series/:serie/:folder/:name
   *
   * V1.2 : `folder` peut valoir 'comics', 'comics_admin', 'img',
   * 'img_admin'. Si le folder est admin-only et le rôle reader,
   * retourne null (la route répondra 404).
   *
   * @param {string} serieName
   * @param {string} folder
   * @param {string} name
   * @param {'reader'|'admin'} [role='reader']
   * @returns {object|null}
   */
  getComics(serieName, folder, name, role = 'reader') {
    // Refus immédiat pour reader sur un folder admin-only
    if (isAdminFolder(folder) && role !== 'admin') return null;

    const s = this.series[serieName];
    if (!s) return null;

    const base = (folder === 'comics' || folder === 'comics_admin')
      ? 'comics'
      : 'img';

    const c = (s[base] || []).find(
      (x) => x.name === name && x.folder === folder
    );
    if (!c) return null;

    // Double vérification (défense en profondeur)
    if (!Store.isVisible(c, role)) return null;

    return {
      serie: serieName,
      folder,
      name: c.name,
      adminOnly: c.adminOnly === true,
      hasVideo: c.hasVideo === true,
      pages: c.pages.map((p) => ({
        file: p.file,
        type: p.type,
        num: p.num,
      })),
    };
  }

  /**
   * V1.2 — Récupère la liste brute (avec folder/adminOnly) des comics
   * d'une série pour une base donnée ('comics' ou 'img'), filtrée
   * selon le rôle. Utilisé par les suggestions.
   *
   * @param {string} serieName
   * @param {'comics'|'img'} base
   * @param {'reader'|'admin'} role
   * @returns {Array<object>}
   */
  getComicsListForRole(serieName, base, role) {
    const s = this.series[serieName];
    if (!s) return [];
    return (s[base] || []).filter((c) => Store.isVisible(c, role));
  }
}

module.exports = { Store };