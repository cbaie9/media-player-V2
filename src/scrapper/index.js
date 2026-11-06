'use strict';

/**
 * Barrel du module Scrapper (V1.5).
 *
 * ⚠️ `./runner` n'est PAS require au chargement : il est accédé via un
 * lazy getter `getRunClass()`. Conséquence : ce barrel ne crashe pas
 * le boot si `src/scrapper/runner.js` est absent (utile pour les
 * déploiements incrémentaux ou les tests isolés).
 */

const { buildScrapperRouter } = require('./routes');
const registry = require('./registry');

/**
 * Tue tous les runs actifs (SIGTERM puis SIGKILL à +3 s).
 * À appeler au shutdown du serveur (SIGINT/SIGTERM).
 *
 * @param {string} [reason='shutdown']
 * @returns {number} Nombre de runs pour lesquels un kill a été demandé
 */
function shutdown(reason = 'shutdown') {
  return registry.killAll(reason);
}

/**
 * Accès lazy à la classe Run (Lot 3). Évite d'imposer `./runner`
 * au chargement du barrel.
 * @returns {Function}
 */
function getRunClass() {
  return require('./runner').Run;
}

module.exports = {
  buildScrapperRouter,
  registry,
  shutdown,
  getRunClass,
};