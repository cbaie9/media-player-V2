'use strict';

const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/**
 * Retourne le Content-Type associé à une extension.
 * @param {string} ext - extension sans point (ex: "png")
 * @returns {string} Content-Type ou 'application/octet-stream' par défaut
 */
function mimeFromExt(ext) {
  if (!ext) return 'application/octet-stream';
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = { mimeFromExt, MIME_TYPES };