#!/usr/bin/env node
'use strict';

const { loadConfig } = require('../src/config');
const { Store } = require('../src/store');
const { Logger } = require('../src/logger');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveFromProject(p) {
  return path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
}

function main() {
  const { config } = loadConfig();

  const logger = new Logger({
    filePath: resolveFromProject(config.APP_LOG_FILE),
  });

  const store = new Store({
    rootDir: config.ROOT_DIR,
    cacheFile: resolveFromProject(config.CACHE_FILE),
    warningsFile: resolveFromProject(config.WARNINGS_FILE),
    logger,
  });

  const res = store.rescan();

  if (res.error) {
    console.error(`❌ Rescan échoué : ${res.error}`);
    process.exit(1);
  }

  console.log(`✅ Rescan terminé en ${res.durationMs} ms`);
  console.log(`   - Séries    : ${res.seriesCount}`);
  console.log(`   - Comics    : ${res.comicsCount}`);
  console.log(`   - Warnings  : ${res.warningsCount}`);
}

main();