'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseFilename, typeFromExt } = require('./utils/parseFilename');
const { safeResolve } = require('./security');
const {
  EXT_PRIORITY,
  SUPPORTED_EXT_RE,
} = require('./utils/extensions');

/**
 * V1.5.3 — EXT_PRIORITY et SUPPORTED_EXT_RE sont désormais dérivés
 * de `utils/extensions.js` (source de vérité unique).
 *
 * EXT_PRIORITY : ordre alpha strict images puis vidéos (A3) :
 *     avif < gif < jpeg < jpg < jxl < png < webp  (images)
 *     mp4 < webm                                   (vidéos)
 *
 * SUPPORTED_EXT_RE : pré-filtre rapide avant parseFilename.
 *     /\.(?:avif|gif|jpeg|jpg|jxl|png|webp|mp4|webm)$/i
 */

const EXT_PRIORITY_INDEX = Object.fromEntries(
  EXT_PRIORITY.map((e, i) => [e, i])
);

// ─── Constantes folders (inchangées) ──────────────────────────────────
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

function isAdminFolder(folder) {
  return folder === FOLDER_COMICS_ADMIN || folder === FOLDER_IMG_ADMIN;
}

function baseFolder(folder) {
  return folder === FOLDER_COMICS || folder === FOLDER_COMICS_ADMIN
    ? FOLDER_COMICS
    : FOLDER_IMG;
}

const REASONS = Object.freeze({
  NOM_NON_CONFORME: 'nom_non_conforme',
  EXTENSION_NON_SUPPORTE: 'extension_non_supporte',
  NUMERO_INVALIDE: 'numero_invalide',
  FICHIER_ILLISIBLE: 'fichier_illisible',
  DOSSIER_IGNORE: 'dossier_ignore',
});

function extPriority(ext) {
  return EXT_PRIORITY_INDEX[ext] ?? Infinity;
}

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
 * V1.1 : chaque page porte `hasVideo` (bool), chaque comics aussi.
 * V1.2 : chaque comics porte `folder` + `adminOnly`.
 * V1.5.2 : .jxl et .avif acceptés comme images.
 * V1.5.3 : liste des extensions dérivée de `utils/extensions.js`.
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
    if (entry.isSymbolicLink()) continue;

    const lowerName = entry.name.toLowerCase();
    const relPath = `${dirRel}/${lowerName}`;

    if (entry.isDirectory()) {
      pushWarning(warnings, relPath, REASONS.DOSSIER_IGNORE);
      continue;
    }

    if (!entry.isFile()) continue;

    if (entry.name.startsWith('.')) {
      pushWarning(warnings, relPath, REASONS.NOM_NON_CONFORME);
      continue;
    }

    if (!SUPPORTED_EXT_RE.test(lowerName)) {
      pushWarning(warnings, relPath, REASONS.EXTENSION_NON_SUPPORTE);
      continue;
    }

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

function compareComics(a, b) {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return (a.adminOnly ? 1 : 0) - (b.adminOnly ? 1 : 0);
}

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
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const serieName = entry.name.toLowerCase();
    const serieRoot = path.join(realRoot, entry.name);

    const { comics, img } = scanSerieFolders(serieRoot, serieName, warnings);

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
  EXT_PRIORITY,       // ré-export pour compat (tests existants)
  FOLDER_COMICS,
  FOLDER_COMICS_ADMIN,
  FOLDER_IMG,
  FOLDER_IMG_ADMIN,
  ALL_FOLDERS,
  isAdminFolder,
  baseFolder,
};