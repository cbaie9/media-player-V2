'use strict';

/**
 * V1.5.3 — Source de vérité UNIQUE pour les extensions de médias.
 *
 * Centralise :
 *   - la liste ordonnée des extensions
 *   - le type (image / video) associé
 *   - le MIME associé
 *   - la priorité de dédoublonnage (A3) — définie par l'ordre de la liste
 *   - la regex A1 (parseFilename) — dérivée de la liste
 *   - la regex pré-filtre (scanner) — dérivée de la liste
 *
 * ⚠️ Toute extension ajoutée/retirée DOIT l'être uniquement ici.
 *    Les modules `parseFilename`, `mime`, `scanner`, `app` et le
 *    fixture E2E `server-fixture` dérivent tous leurs comportements
 *    de ce fichier.
 *
 * ⚠️ L'ORDRE des entrées ci-dessous est SIGNIFICATIF :
 *   - il définit la priorité de dédoublonnage du scanner (A3)
 *   - il définit l'ordre des alternatives dans FILENAME_REGEX
 *   - il est alpha strict, images puis vidéos (cf. CDC A3)
 *
 *   avif < gif < jpeg < jpg < jxl < png < webp   (images)
 *   mp4 < webm                                    (vidéos)
 */

const EXTENSIONS = Object.freeze([
  // ─── Images (ordre alpha strict) ───────────────────────────────────
  { ext: 'avif', type: 'image', mime: 'image/avif' },
  { ext: 'gif',  type: 'image', mime: 'image/gif' },
  { ext: 'jpeg', type: 'image', mime: 'image/jpeg' },
  { ext: 'jpg',  type: 'image', mime: 'image/jpeg' },
  { ext: 'jxl',  type: 'image', mime: 'image/jxl' },
  { ext: 'png',  type: 'image', mime: 'image/png' },
  { ext: 'webp', type: 'image', mime: 'image/webp' },
  // ─── Vidéos (ordre alpha strict) ───────────────────────────────────
  { ext: 'mp4',  type: 'video', mime: 'video/mp4' },
  { ext: 'webm', type: 'video', mime: 'video/webm' },
]);

// ─── Dérivés immuables ────────────────────────────────────────────────

/** Liste plate des extensions valides, dans l'ordre de priorité A3. */
const VALID_EXTENSIONS = Object.freeze(EXTENSIONS.map((e) => e.ext));

/** Alias sémantique — l'ordre de VALID_EXTENSIONS EST la priorité A3. */
const EXT_PRIORITY = VALID_EXTENSIONS;

/** Mapping ext → MIME. */
const MIME_TYPES = Object.freeze(
  Object.fromEntries(EXTENSIONS.map((e) => [e.ext, e.mime]))
);

/** Mapping ext → type ('image' | 'video'). */
const TYPE_BY_EXT = Object.freeze(
  Object.fromEntries(EXTENSIONS.map((e) => [e.ext, e.type]))
);

/** Sous-ensembles filtrés (utiles pour des tests / UI futurs). */
const IMAGE_EXTENSIONS = Object.freeze(
  EXTENSIONS.filter((e) => e.type === 'image').map((e) => e.ext)
);
const VIDEO_EXTENSIONS = Object.freeze(
  EXTENSIONS.filter((e) => e.type === 'video').map((e) => e.ext)
);

/**
 * Alternation pour la regex A1 (parseFilename).
 * Ex : "avif|gif|jpeg|jpg|jxl|png|webp|mp4|webm"
 */
const EXT_ALTERNATION = VALID_EXTENSIONS.join('|');

/**
 * Regex pré-filtre (scanner) : rapide, insensible à la casse.
 * Ex : /\.(?:avif|gif|jpeg|jpg|jxl|png|webp|mp4|webm)$/i
 */
const SUPPORTED_EXT_RE = new RegExp(`\\.(?:${EXT_ALTERNATION})$`, 'i');

/**
 * Regroupe les extensions par MIME, pour `express.static.mime.define()`.
 * Ex : { 'image/jpeg': ['jpeg', 'jpg'], 'image/jxl': ['jxl'], ... }
 */
function mimeGroups() {
  /** @type {Record<string, string[]>} */
  const groups = {};
  for (const { ext, mime } of EXTENSIONS) {
    if (!groups[mime]) groups[mime] = [];
    groups[mime].push(ext);
  }
  return groups;
}

module.exports = {
  EXTENSIONS,
  VALID_EXTENSIONS,
  EXT_PRIORITY,
  MIME_TYPES,
  TYPE_BY_EXT,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  EXT_ALTERNATION,
  SUPPORTED_EXT_RE,
  mimeGroups,
};