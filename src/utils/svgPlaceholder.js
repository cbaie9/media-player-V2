'use strict';

/**
 * Génère un placeholder SVG inline (base64 data-URI).
 * Utilisé pour les vignettes de comics sans image (D2).
 *
 * @param {object} [opts]
 * @param {number} [opts.width=200]
 * @param {number} [opts.height=280]
 * @param {string} [opts.label='?']
 * @param {string} [opts.bg='#2a2a2e']
 * @param {string} [opts.fg='#8a8a92']
 * @returns {string} data-URI utilisable dans src="..."
 */
function svgPlaceholder(opts = {}) {
  const {
    width = 200,
    height = 280,
    label = '?',
    bg = '#2a2a2e',
    fg = '#8a8a92',
  } = opts;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Aucune image disponible">
  <rect width="100%" height="100%" fill="${bg}"/>
  <text x="50%" y="50%" fill="${fg}" font-family="system-ui,sans-serif" font-size="48" text-anchor="middle" dominant-baseline="central">${label}</text>
</svg>`;

  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

/**
 * Retourne une URL de couverture ou un placeholder.
 * @param {string|null} cover
 * @param {string} serie
 * @param {string} folder
 * @returns {string}
 */
function coverUrl(cover, serie, folder) {
  if (cover) {
    return `/media/${encodeURIComponent(serie)}/${folder}/${encodeURIComponent(cover)}`;
  }
  return svgPlaceholder({ label: '?' });
}

module.exports = { svgPlaceholder, coverUrl };