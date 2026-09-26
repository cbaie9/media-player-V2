'use strict';

/**
 * Regex A1 — parsing des noms de fichiers comics.
 * Format strict : %nom%-%page%.%ext%  (4 ou 6 chiffres, zéro-padded)
 */
const FILENAME_REGEX =
  /^(?<name>.+)-(?<page>\d{4}|\d{6})\.(?<ext>png|jpe?g|webp|gif|mp4|webm)$/;

const VALID_EXTENSIONS = ['png', 'jpeg', 'jpg', 'webp', 'gif', 'mp4', 'webm'];

/**
 * Tente de parser un nom de fichier selon la regex A1.
 * Retourne null si le nom est non conforme (A2).
 *
 * @param {string} filename - Nom de fichier brut (avec extension)
 * @returns {{ name: string, page: number, ext: string, pageRaw: string } | null}
 */
function parseFilename(filename) {
  if (typeof filename !== 'string' || filename.length === 0) return null;

  // A4 : normalisation lowercase sur nom ET extension
  const lower = filename.toLowerCase();

  // Note §5 : fichiers cachés (préfixe '.') ignorés
  if (lower.startsWith('.')) return null;

  const match = FILENAME_REGEX.exec(lower);
  if (!match) return null;

  const { name, page, ext } = match.groups;

  // Sécurité : le nom ne doit pas être vide
  if (!name || name.length === 0) return null;

  return {
    name,
    page: parseInt(page, 10),
    pageRaw: page, // conserve le padding pour référence
    ext,
  };
}

/**
 * Détermine le type de média à partir de l'extension.
 * @param {string} ext
 * @returns {'image' | 'video' | null}
 */
function typeFromExt(ext) {
  if (['png', 'jpeg', 'jpg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  return null;
}

module.exports = {
  parseFilename,
  typeFromExt,
  FILENAME_REGEX,
  VALID_EXTENSIONS,
};