'use strict';

const { MIME_TYPES } = require('./extensions');

/**
 * Retourne le Content-Type associé à une extension.
 * @param {string} ext - extension sans point (ex: "png")
 * @returns {string} Content-Type ou 'application/octet-stream' par défaut
 */
function mimeFromExt(ext) {
  if (!ext || typeof ext !== 'string') return 'application/octet-stream';
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = { mimeFromExt, MIME_TYPES };