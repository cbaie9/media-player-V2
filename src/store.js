'use strict';

const path = require('node:path');
const {
  scanRoot,
  writeWarningsLog,
} = require('./scanner');
const {
  buildCachePayload,
  writeCache,
  readCache,
} = require('./cache');

/**
 * Store : encapsule la structure de données du site.
 *
 * Responsabilités :
 *  - Charger depuis le cache si présent et valide (B1)
 *  - Sinon, scanner la racine et écrire le cache (B1)
 *  - Exposer des helpers pour l'API (/api/series, /api/series/:serie, etc.)
 *  - Fournir un `rescan()` pour POST /api/rescan (B2)
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

    /** @type {object} — { serieName: { comics: [], img: [] } } */
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
    if (!cache) return false;

    // Vérifie que le rootDir n'a pas changé
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
      // B3 : ROOT_DIR cassé → on garde une structure vide + on remonte l'erreur
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

    // Écrit le cache (atomique)
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

    // Écrit les warnings (écrase)
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

  /**
   * Liste des séries au format /api/series.
   * @returns {Array<{ name: string, comicsCount: number, imgCount: number }>}
   */
  listSeries() {
    return Object.entries(this.series)
      .map(([name, s]) => ({
        name,
        comicsCount: (s.comics || []).length,
        imgCount: (s.img || []).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Détail d'une série : /api/series/:serie
   * @param {string} serieName
   * @returns {object|null}
   */
  getSerie(serieName) {
    const s = this.series[serieName];
    if (!s) return null;

    const mapList = (list) =>
      (list || []).map((c) => ({
        name: c.name,
        pageCount: c.pages.length,
        cover: c.pages.length > 0 ? c.pages[0].file : null,
      }));

    return {
      name: serieName,
      comics: mapList(s.comics),
      img: mapList(s.img),
    };
  }

  /**
   * Détail d'un comics : /api/series/:serie/:folder/:name
   * @param {string} serieName
   * @param {'comics'|'img'} folder
   * @param {string} name
   * @returns {object|null}
   */
  getComics(serieName, folder, name) {
    const s = this.series[serieName];
    if (!s) return null;
    if (folder !== 'comics' && folder !== 'img') return null;

    const c = (s[folder] || []).find((x) => x.name === name);
    if (!c) return null;

    return {
      serie: serieName,
      folder,
      name: c.name,
      pages: c.pages.map((p) => ({
        file: p.file,
        type: p.type,
        num: p.num,
      })),
    };
  }
}

module.exports = { Store };