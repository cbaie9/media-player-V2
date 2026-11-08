'use strict';

const {
  EXT_ALTERNATION,
  VALID_EXTENSIONS,
  TYPE_BY_EXT,
} = require('./extensions');

/**
 * Regex A1 — parsing des noms de fichiers comics.
 * Format strict : %nom%-%page%.%ext%  (4, 5 ou 6 chiffres, zéro-padded)
 *
 * V1.5.3 — l'alternation d'extensions est dérivée de `extensions.js`.
 * L'ordre des alternatives est alpha strict (images puis vidéos).
 *
 * Comportement identique à V1.5.2 (qui utilisait `png|jpe?g|…`).
 */
const FILENAME_REGEX = new RegExp(
  `^(?<name>.+)-(?<page>\\d{4,6})\\.(?<ext>${EXT_ALTERNATION})$`
);

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
    pageRaw: page,
    ext,
  };
}

/**
 * Détermine le type de média à partir de l'extension.
 * Dérivé de `TYPE_BY_EXT` (extensions.js).
 *
 * @param {string} ext
 * @returns {'image' | 'video' | null}
 */
function typeFromExt(ext) {
  if (!ext || typeof ext !== 'string') return null;
  return TYPE_BY_EXT[ext.toLowerCase()] || null;
}

module.exports = {
  parseFilename,
  typeFromExt,
  FILENAME_REGEX,
  VALID_EXTENSIONS, // ré-export pour compat
};