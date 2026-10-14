'use strict';

const path = require('node:path');
const { loadConfig } = require('./config');
const { Logger } = require('./logger');
const { Store } = require('./store');
const { buildApp, resolveFromProject } = require('./app');

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

  // -------------------------------------------------------------------------
  // V1.2 — Rescan forcé au démarrage.
  //
  // Historique V1.1 : on chargeait le cache s'il était valide, sinon on
  // scannait. Le cache V1.2 (version 3) est plus riche (folder + adminOnly),
  // et l'ajout/suppression de dossiers `_admin` doit être pris en compte
  // immédiatement sans attendre un `npm run rescan` manuel.
  //
  // On garde le fallback gracieux : si le scan échoue (ROOT_DIR absent),
  // `store.error` est positionné et le serveur démarre quand même avec
  // une structure vide (comportement identique à V1.1).
  // -------------------------------------------------------------------------
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
    console.log(`✅ media-player-v2 démarré sur http://localhost:${config.PORT}`);
    console.log(`   ROOT_DIR : ${config.ROOT_DIR}`);
    console.log(`   Séries   : ${store.listSeries('admin').length}`);
  });

  // Arrêt propre
  const shutdown = (signal) => {
    logger.info('server_stop', { reason: signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();