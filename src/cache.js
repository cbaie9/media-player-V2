'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Version du schéma du cache (cf. §3).
 *
 * V1.1 — bump 1 → 2 : ajout du champ `hasVideo` par page et par comics.
 * V1.2 — bump 2 → 3 : ajout des dossiers `comics_admin/` et `img_admin/`,
 *        ajout des champs `folder` et `adminOnly` sur chaque comics,
 *        ajout du champ `adminOnly` sur chaque série.
 * Un cache de version antérieure est ignoré → rescan automatique.
 */
const CACHE_VERSION = 3;

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
 * @param {object} params.series  - Dictionnaire { serieName: { adminOnly, comics: [], img: [] } }
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
 * V1.2 : un cache version < 3 est ignoré (cache_version_mismatch sera
 * loggé par Store.loadFromCache si un logger est fourni).
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
 * Lit la version d'un cache sans le valider (pour logging).
 * @param {string} filePath
 * @returns {number|null}
 */
function peekCacheVersion(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'number') return parsed.version;
  } catch {
    // ignore
  }
  return null;
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
  peekCacheVersion,
  clearCache,
  writeJsonAtomic,
};