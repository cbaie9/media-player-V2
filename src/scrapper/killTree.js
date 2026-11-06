'use strict';

const { spawn } = require('node:child_process');

/**
 * Tue un processus enfant ET son arbre (groupe de processus).
 *
 * V1.5 — D8 : kill cross-platform
 *   - POSIX : `detached: true` a été passé au spawn, l'enfant est chef
 *     de groupe → `process.kill(-pid, signal)` tue tout le groupe,
 *     y compris les sous-processus éventuels (ex : subprocess.Popen
 *     lancés par le script Python).
 *   - Windows : pas de notion de groupe de processus → `taskkill /T /F`
 *     tue l'arbre entier.
 *
 * Cette fonction est idempotente et silencieuse :
 *   - si le process est déjà mort (exitCode ou signalCode défini),
 *     elle ne fait rien ;
 *   - si le kill échoue (ESRCH, EPERM…), elle avale l'erreur ;
 *   - elle n'émet jamais d'événement ni de log (le Run s'en charge).
 *
 * @param {import('node:child_process').ChildProcess | null | undefined} child
 * @param {NodeJS.Signals | string} [signal='SIGTERM']
 * @returns {boolean} true si un kill a été tenté, false sinon
 */
function killTree(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return false;
  if (child.exitCode !== null || child.signalCode !== null) return false;

  try {
    if (process.platform === 'win32') {
      // Windows : taskkill /T tue l'arbre, /F force la terminaison.
      // On l'invoque en fire-and-forget, sans attendre la fin
      // (taskkill peut prendre ~200ms ; on ne bloque pas la boucle).
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true }
      );
      killer.on('error', () => {
        /* silencieux : process peut déjà être mort */
      });
      // Pas de .unref() : on veut que le process survive à un restart Node
      // suffisamment longtemps pour terminer le kill de l'arbre.
    } else {
      // POSIX : négatif = groupe de processus entier.
      // (requiert que child ait été spawn avec `detached: true`).
      process.kill(-child.pid, signal);
    }
    return true;
  } catch (err) {
    // ESRCH : process déjà mort → OK
    // EPERM : pas les droits → on ne peut rien y faire
    // EINVAL : signal invalide → ne devrait pas arriver
    return false;
  }
}

/**
 * Tue un processus enfant en douceur (SIGTERM) puis en force (SIGKILL)
 * après un délai de grâce.
 *
 * V1.5 — D7/D9 :
 *   - timeout d'exécution Python → kill immédiat (SIGTERM puis SIGKILL)
 *   - déconnexion client → idem
 *   - arrêt du serveur → idem
 *   - jamais de grâce pour SIGKILL (c'est le but)
 *
 * @param {import('node:child_process').ChildProcess | null | undefined} child
 * @param {object} [opts]
 * @param {number} [opts.graceMs=3000] - Délai avant SIGKILL
 * @param {() => boolean} [opts.isFinished] - Prédicat optionnel : si true, on n'envoie pas le SIGKILL (le process s'est terminé entre temps)
 * @returns {void}
 */
function killTreeWithGrace(child, opts = {}) {
  const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : 3000;
  const isFinished = typeof opts.isFinished === 'function' ? opts.isFinished : () => false;

  const sent = killTree(child, 'SIGTERM');
  if (!sent) return;

  // Timer de secours : si le process n'est pas mort dans le délai,
  // on envoie SIGKILL. Le timer est `unref`'d pour ne pas bloquer
  // l'arrêt du serveur Node.
  const timer = setTimeout(() => {
    if (isFinished()) return;
    killTree(child, 'SIGKILL');
  }, graceMs);

  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { killTree, killTreeWithGrace };