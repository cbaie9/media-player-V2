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
 * Scanne un dossier `comics/` ou `img/` d'une série.
 *
 * A3 : dédoublonnage par priorité d'extension (image avant video).
 * A4 : normalisation lowercase sur le nom de fichier avant tout traitement.
 * A5 : les symlinks sont ignorés silencieusement (aucun warning).
 *
 * @param {string} dirAbs
 * @param {string} dirRel
 * @param {string[]} warnings
 * @returns {Array<{ name: string, pages: Array<object> }>}
 */
function scanFolder(dirAbs, dirRel, warnings) {
  if (!fs.existsSync(dirAbs)) return [];

  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    pushWarning(warnings, dirRel, REASONS.FICHIER_ILLISIBLE);
    return [];
  }

  /** @type {Map<string, Map<number, { file, ext, type, num }>>} */
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
    // Testé sur le nom original ET le nom normalisé (le '.' ne change pas)
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
      // Distingue "numéro invalide" (padding incorrect, ex: -01)
      // de "nom non conforme" (structure absente).
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
      // (c.-à-d. index le plus petit dans EXT_PRIORITY).
      const prevPri = extPriority(existing.ext);
      const currPri = extPriority(parsed.ext);

      if (currPri < prevPri) {
        // Le nouveau gagne
        bucket.set(parsed.page, {
          file: lowerName,
          ext: parsed.ext,
          type,
          num: parsed.page,
        });
        pushWarning(
          warnings,
          relPath,
          REASONS.NUMERO_INVALIDE,
          `doublon résolu en faveur de .${parsed.ext}`
        );
      } else {
        // L'existant gagne
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
    });
  }

  const comics = [];
  for (const [name, pagesMap] of byName) {
    const pages = [...pagesMap.values()].sort((a, b) => a.num - b.num);
    comics.push({ name, pages });
  }
  comics.sort((a, b) => a.name.localeCompare(b.name));
  return comics;
}

/**
 * Scanne la racine complète.
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
    const comicsDir = path.join(realRoot, entry.name, 'comics');
    const imgDir = path.join(realRoot, entry.name, 'img');

    const comics = scanFolder(comicsDir, `${serieName}/comics`, warnings);
    const img = scanFolder(imgDir, `${serieName}/img`, warnings);

    series[serieName] = { comics, img };
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
  writeWarningsLog,
  REASONS,
  EXT_PRIORITY,
};