'use strict';

const path = require('node:path');
const { loadConfig } = require('./config');
const { Logger } = require('./logger');
const { Store } = require('./store');
const { buildApp, resolveFromProject } = require('./app');
const scrapper = require('./scrapper');

function main() {
  const { config, sessionSecret } = loadConfig();

  const logger = new Logger({
    filePath: resolveFromProject(config.APP_LOG_FILE),
  });

  const store = new Store({
    rootDir: config.ROOT_DIR,
    cacheFile: resolveFromProject(config.CACHE_FILE),
    warningsFile: resolveFromProject(config.WARNINGS_FILE),
    logger,
  });

  // V1.2 — Rescan forcé au démarrage (cf. décision §4).
  const init = store.rescan();

  logger.info('server_start', {
    port: config.PORT,
    rootDir: config.ROOT_DIR,
    source: 'scan',
    seriesCount: init.seriesCount,
    comicsCount: init.comicsCount,
    warnings: init.warningsCount,
    durationMs: init.durationMs,
  });

  if (store.error === 'root_dir_unavailable') {
    logger.warn('root_dir_error', {
      message: `ROOT_DIR inaccessible : ${config.ROOT_DIR}`,
    });
  }

  const app = buildApp({ config, sessionSecret, store, logger });

  const server = app.listen(config.PORT, () => {
    console.log(
      `✅ media-player-v2 démarré sur http://localhost:${config.PORT}`
    );
    console.log(`   ROOT_DIR : ${config.ROOT_DIR}`);
    console.log(`   Séries   : ${store.listSeries('admin').length}`);

    // V1.5 — Statut du module Scrapper au boot
    if (config.python_module) {
      console.log(
        `   Scrapper : activé (${config.python_module.python_executable})`
      );
    } else {
      console.log(
        `   Scrapper : désactivé (${config.python_module_disabled_reason || 'non configuré'})`
      );
    }
  });

  // Arrêt propre
  const shutdown = (signal) => {
    logger.info('server_stop', { reason: signal });

    // V1.5 — Tuer les runs Scrapper AVANT server.close() pour ne pas
    // laisser de process Python détachés orphelins.
    try {
      const killed = scrapper.shutdown('shutdown');
      if (killed > 0) {
        logger.info('scrapper_shutdown', { runsKilled: killed });
      }
    } catch (err) {
      logger.warn('scrapper_shutdown_error', { message: err.message });
    }

    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();