'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Version du schéma du cache (cf. §3).
 * À incrémenter si le schéma change.
 */
const CACHE_VERSION = 1;

/**
 * Écrit un JSON de façon atomique (R4) :
 *   1. Écrit dans un fichier temporaire dans le même dossier
 *   2. fsync
 *   3. rename() sur le fichier cible (atomique sur POSIX)
 *
 * @param {string} filePath
 * @param {object} data
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  const json = JSON.stringify(data, null, 2) + '\n';

  let fd;
  try {
    fd = fs.openSync(tmpPath, 'w', 0o600);
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, filePath);
}

/**
 * Construit un objet cache conforme au §3.
 *
 * @param {object} params
 * @param {string} params.rootDir - Chemin absolu
 * @param {object} params.series  - Dictionnaire { serieName: { comics: [], img: [] } }
 * @param {Date}  [params.now]
 * @returns {object}
 */
function buildCachePayload({ rootDir, series, now = new Date() }) {
  return {
    version: CACHE_VERSION,
    generatedAt: now.toISOString(),
    rootDir,
    series: series || {},
  };
}

/**
 * Écrit le cache sur disque (atomique).
 * @param {string} filePath
 * @param {object} payload
 */
function writeCache(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

/**
 * Lit le cache. Retourne `null` si :
 *   - le fichier n'existe pas
 *   - le JSON est invalide (corrompu → rescan silencieux)
 *   - la version ne correspond pas (→ rescan)
 *   - la structure minimale est absente
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function readCache(filePath) {
  if (!fs.existsSync(filePath)) return null;

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version !== CACHE_VERSION) return null;
  if (typeof parsed.series !== 'object' || parsed.series === null) return null;

  return parsed;
}

/**
 * Supprime le cache (utile pour un rescan forcé).
 * @param {string} filePath
 */
function clearCache(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Absent : rien à faire
  }
}

module.exports = {
  CACHE_VERSION,
  buildCachePayload,
  writeCache,
  readCache,
  clearCache,
  writeJsonAtomic,
};