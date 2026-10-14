'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseFilename, typeFromExt } = require('./utils/parseFilename');
const { safeResolve } = require('./security');

/**
 * A3 — Ordre de priorité pour le dédoublonnage.
 *
 * Rappel du CDC : « alphabétique strict des extensions, rappel image puis video » :
 *     gif < jpeg < jpg < png < webp < mp4 < webm
 *
 * → d'abord toutes les IMAGES en ordre alphabétique,
 *   puis toutes les VIDÉOS en ordre alphabétique.
 */
const EXT_PRIORITY = ['gif', 'jpeg', 'jpg', 'png', 'webp', 'mp4', 'webm'];
const EXT_PRIORITY_INDEX = Object.fromEntries(
  EXT_PRIORITY.map((e, i) => [e, i])
);

/**
 * V1.2 — Dossiers reconnus dans une série.
 *
 * Un dossier est « admin-only » si son nom se termine par `_admin`.
 * Le nom « logique » (base) est `comics` ou `img`.
 */
const FOLDER_COMICS = 'comics';
const FOLDER_COMICS_ADMIN = 'comics_admin';
const FOLDER_IMG = 'img';
const FOLDER_IMG_ADMIN = 'img_admin';

const ALL_FOLDERS = Object.freeze([
  FOLDER_COMICS,
  FOLDER_COMICS_ADMIN,
  FOLDER_IMG,
  FOLDER_IMG_ADMIN,
]);

/**
 * V1.2 — Un folder est-il admin-only ?
 * @param {string} folder
 */
function isAdminFolder(folder) {
  return folder === FOLDER_COMICS_ADMIN || folder === FOLDER_IMG_ADMIN;
}

/**
 * V1.2 — Base d'un folder : 'comics' ou 'img'.
 * @param {string} folder
 */
function baseFolder(folder) {
  return folder === FOLDER_COMICS || folder === FOLDER_COMICS_ADMIN
    ? FOLDER_COMICS
    : FOLDER_IMG;
}

/**
 * Codes de raison normalisés (§4.1).
 */
const REASONS = Object.freeze({
  NOM_NON_CONFORME: 'nom_non_conforme',
  EXTENSION_NON_SUPPORTE: 'extension_non_supporte',
  NUMERO_INVALIDE: 'numero_invalide',
  FICHIER_ILLISIBLE: 'fichier_illisible',
  DOSSIER_IGNORE: 'dossier_ignore',
});

/**
 * Index de priorité d'une extension (A3). +Infinity si inconnue.
 * @param {string} ext
 */
function extPriority(ext) {
  return EXT_PRIORITY_INDEX[ext] ?? Infinity;
}

/**
 * Extensions supportées (pré-filtre rapide avant parseFilename).
 */
const SUPPORTED_EXT_RE = /\.(png|jpe?g|webp|gif|mp4|webm)$/i;

function pushWarning(warnings, relPath, reason, note) {
  warnings.push({ relPath, reason, note });
}

/**
 * Scanne un dossier `comics/`, `comics_admin/`, `img/` ou `img_admin/`
 * d'une série.
 *
 * A3 : dédoublonnage par priorité d'extension (image avant video).
 * A4 : normalisation lowercase sur le nom de fichier avant tout traitement.
 * A5 : les symlinks sont ignorés silencieusement (aucun warning).
 *
 * V1.1 — B15 : chaque page porte `hasVideo` (bool), et chaque comics
 * porte aussi `hasVideo` (true si au moins une page vidéo). Le client
 * en a besoin pour décider d'extraire ou non une vignette sans parser
 * l'extension de la cover.
 *
 * V1.2 — chaque comics porte `folder` (nom du dossier source) et
 * `adminOnly` (true si le dossier source est un `_admin`).
 *
 * @param {string} dirAbs
 * @param {string} dirRel
 * @param {string} folderName - Nom logique du dossier ('comics', 'comics_admin', 'img', 'img_admin')
 * @param {string[]} warnings
 * @returns {Array<{ name: string, folder: string, adminOnly: boolean, hasVideo: boolean, pages: Array<object> }>}
 */
function scanFolder(dirAbs, dirRel, folderName, warnings) {
  if (!fs.existsSync(dirAbs)) return [];

  const adminOnly = isAdminFolder(folderName);

  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    pushWarning(warnings, dirRel, REASONS.FICHIER_ILLISIBLE);
    return [];
  }

  /** @type {Map<string, Map<number, { file, ext, type, num, hasVideo }>>} */
  const byName = new Map();

  for (const entry of entries) {
    // A5 — Symlinks ignorés SANS warning. Doit être testé EN PREMIER,
    // car un symlink vers un dossier est vu comme isDirectory() === true
    // par readdirSync({ withFileTypes: true }) sur certaines plateformes.
    if (entry.isSymbolicLink()) continue;

    // A4 — Normalisation lowercase du nom de fichier AVANT tout traitement
    const lowerName = entry.name.toLowerCase();
    const relPath = `${dirRel}/${lowerName}`;

    // Sous-dossier : ignoré + warning dossier_ignore
    if (entry.isDirectory()) {
      pushWarning(warnings, relPath, REASONS.DOSSIER_IGNORE);
      continue;
    }

    if (!entry.isFile()) continue;

    // Fichier caché (préfixe '.') → nom_non_conforme
    if (entry.name.startsWith('.')) {
      pushWarning(warnings, relPath, REASONS.NOM_NON_CONFORME);
      continue;
    }

    // Pré-filtre : extension supportée ? Sinon → extension_non_supporte
    if (!SUPPORTED_EXT_RE.test(lowerName)) {
      pushWarning(warnings, relPath, REASONS.EXTENSION_NON_SUPPORTE);
      continue;
    }

    // Regex A1 + normalisation A4 (parseFilename reçoit le nom normalisé)
    const parsed = parseFilename(lowerName);
    if (!parsed) {
      if (/-\d+\./.test(lowerName)) {
        pushWarning(warnings, relPath, REASONS.NUMERO_INVALIDE);
      } else {
        pushWarning(warnings, relPath, REASONS.NOM_NON_CONFORME);
      }
      continue;
    }

    const type = typeFromExt(parsed.ext);
    if (!type) {
      pushWarning(warnings, relPath, REASONS.EXTENSION_NON_SUPPORTE);
      continue;
    }

    let bucket = byName.get(parsed.name);
    if (!bucket) {
      bucket = new Map();
      byName.set(parsed.name, bucket);
    }

    const existing = bucket.get(parsed.page);
    if (existing) {
      // A3 — dédoublonnage : on garde l'extension de priorité la PLUS BASSE
      const prevPri = extPriority(existing.ext);
      const currPri = extPriority(parsed.ext);

      if (currPri < prevPri) {
        bucket.set(parsed.page, {
          file: lowerName,
          ext: parsed.ext,
          type,
          num: parsed.page,
          hasVideo: type === 'video',
        });
        pushWarning(
          warnings,
          relPath,
          REASONS.NUMERO_INVALIDE,
          `doublon résolu en faveur de .${parsed.ext}`
        );
      } else {
        pushWarning(
          warnings,
          relPath,
          REASONS.NUMERO_INVALIDE,
          `doublon résolu en faveur de .${existing.ext}`
        );
      }
      continue;
    }

    bucket.set(parsed.page, {
      file: lowerName,
      ext: parsed.ext,
      type,
      num: parsed.page,
      hasVideo: type === 'video',
    });
  }

  const comics = [];
  for (const [name, pagesMap] of byName) {
    const pages = [...pagesMap.values()].sort((a, b) => a.num - b.num);
    const hasVideo = pages.some((p) => p.hasVideo === true);
    comics.push({
      name,
      folder: folderName,
      adminOnly,
      hasVideo,
      pages,
    });
  }
  comics.sort((a, b) => a.name.localeCompare(b.name));
  return comics;
}

/**
 * V1.2 — Scanne les 4 dossiers possibles d'une série et retourne
 * un objet { comics, img } où chaque liste contient les comics des
 * deux folders (normal + admin) fusionnés.
 *
 * Le tri final est : alpha par nom, puis admin en second (déterministe).
 *
 * @param {string} serieRoot
 * @param {string} serieName
 * @param {string[]} warnings
 * @returns {{ comics: Array<object>, img: Array<object> }}
 */
function scanSerieFolders(serieRoot, serieName, warnings) {
  const comicsNormal = scanFolder(
    path.join(serieRoot, FOLDER_COMICS),
    `${serieName}/${FOLDER_COMICS}`,
    FOLDER_COMICS,
    warnings
  );
  const comicsAdmin = scanFolder(
    path.join(serieRoot, FOLDER_COMICS_ADMIN),
    `${serieName}/${FOLDER_COMICS_ADMIN}`,
    FOLDER_COMICS_ADMIN,
    warnings
  );
  const imgNormal = scanFolder(
    path.join(serieRoot, FOLDER_IMG),
    `${serieName}/${FOLDER_IMG}`,
    FOLDER_IMG,
    warnings
  );
  const imgAdmin = scanFolder(
    path.join(serieRoot, FOLDER_IMG_ADMIN),
    `${serieName}/${FOLDER_IMG_ADMIN}`,
    FOLDER_IMG_ADMIN,
    warnings
  );

  const comics = [...comicsNormal, ...comicsAdmin].sort(compareComics);
  const img = [...imgNormal, ...imgAdmin].sort(compareComics);

  return { comics, img };
}

/**
 * V1.2 — Tri déterministe : alpha par nom puis admin après normal.
 */
function compareComics(a, b) {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return (a.adminOnly ? 1 : 0) - (b.adminOnly ? 1 : 0);
}

/**
 * Scanne la racine complète.
 *
 * V1.2 — une série porte `adminOnly = true` si aucun comics/img
 * accessible au reader n'existe (c.-à-d. uniquement des `_admin`).
 */
function scanRoot({ rootDir }) {
  const warnings = [];
  const series = {};

  const absRoot = path.resolve(rootDir);

  let realRoot;
  try {
    realRoot = safeResolve(absRoot, '.');
    if (!realRoot) throw new Error('invalid root');
  } catch {
    return {
      series: {},
      warnings,
      stats: { seriesCount: 0, comicsCount: 0 },
      error: 'root_dir_unavailable',
    };
  }

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(realRoot, { withFileTypes: true });
  } catch {
    return {
      series: {},
        warnings,
        stats: { seriesCount: 0, comicsCount: 0 },
        error: 'root_dir_unavailable',
    };
  }

  let comicsCount = 0;

  for (const entry of dirEntries) {
    // A5 — symlinks ignorés silencieusement au niveau racine aussi
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const serieName = entry.name.toLowerCase();
    const serieRoot = path.join(realRoot, entry.name);

    const { comics, img } = scanSerieFolders(serieRoot, serieName, warnings);

    // V1.2 — dérivé : une série est admin-only si RIEN n'est accessible
    // au reader (tous les comics/img sont admin).
    const hasReaderComics = comics.some((c) => !c.adminOnly);
    const hasReaderImg = img.some((c) => !c.adminOnly);
    const adminOnly = !hasReaderComics && !hasReaderImg;

    series[serieName] = { adminOnly, comics, img };
    comicsCount += comics.length + img.length;
  }

  return {
    series,
    warnings,
    stats: {
      seriesCount: Object.keys(series).length,
      comicsCount,
    },
  };
}

/**
 * Écrit les warnings dans un fichier texte (écrasé à chaque scan).
 */
function writeWarningsLog(filePath, warnings, now = () => new Date()) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const lines = warnings.map((w) => {
    const ts = now().toISOString();
    const note = w.note ? ` | note=${w.note}` : '';
    return `${ts} | ${w.relPath} | raison=${w.reason}${note}`;
  });

  const content = lines.length ? lines.join('\n') + '\n' : '';
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

module.exports = {
  scanRoot,
  scanFolder,
  scanSerieFolders,
  writeWarningsLog,
  REASONS,
  EXT_PRIORITY,
  // V1.2 — constantes folders
  FOLDER_COMICS,
  FOLDER_COMICS_ADMIN,
  FOLDER_IMG,
  FOLDER_IMG_ADMIN,
  ALL_FOLDERS,
  isAdminFolder,
  baseFolder,
};