#!/usr/bin/env node
'use strict';

/**
 * Faux "python" pour les tests (V1.5 Lot 8).
 *
 * Le serveur le spawn avec `process.execPath` (binaire node courant)
 * comme `python_executable` → aucun python requis sur la CI.
 *
 * Protocole simulé (cf. runner.js) :
 *   - stdout : logs classiques + marqueurs [PHASE:X, PROGRESS:Y] / [PHASE:X, ERROR]
 *   - stderr : erreurs
 *   - exit code : 0 succès / 1 échec
 *
 * Modes pilotés par argv[2] (input) :
 *   - "ok"                : 3 phases à 100% + "Done." + exit 0
 *   - "fail-phase-2"      : phase 1 à 100%, [PHASE:2, ERROR], exit 1
 *   - "crash"             : stderr "boom", exit 1 (sans marqueur)
 *   - "long"              : attend 30 s (pour tests d'abort/timeout)
 *   - "spawn-error"       : juste stderr puis exit 1 (pour tests d'erreur)
 *   - tout autre input    : "echo" puis exit 0 (défaut)
 *
 * Compat Windows / POSIX : pas de shell, pas de fork, pur Node.
 */

const input = process.argv[2] || '';

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function log(line) {
  process.stdout.write(line + '\n');
}

function err(line) {
  process.stderr.write(line + '\n');
}

async function phase1(passes) {
  for (let i = 0; i <= passes; i++) {
    log(`[PHASE:1, PROGRESS:${Math.round((i / passes) * 100)}]`);
    await sleep(5);
  }
}

async function phase2(passes) {
  for (let i = 0; i <= passes; i++) {
    log(`[PHASE:2, PROGRESS:${Math.round((i / passes) * 100)}]`);
    await sleep(5);
  }
}

async function phase3(passes) {
  for (let i = 0; i <= passes; i++) {
    log(`[PHASE:3, PROGRESS:${Math.round((i / passes) * 100)}]`);
    await sleep(5);
  }
}

async function main() {
  log(`Connexion au site ${input}`);

  if (input === 'ok') {
    await phase1(4);
    await phase2(4);
    await phase3(4);
    log('Done.');
    process.exit(0);
  }

  if (input === 'fail-phase-2') {
    await phase1(2);
    log('[PHASE:2, ERROR]');
    err('Simulated phase 2 failure');
    process.exit(1);
  }

  if (input === 'crash') {
    err('boom');
    process.exit(1);
  }

  if (input === 'long') {
    await sleep(30_000);
    log('Done (long).');
    process.exit(0);
  }

  if (input === 'spawn-error') {
    err('something went wrong');
    process.exit(1);
  }

  // Défaut : écho minimal pour valider le flux
  log(`[PHASE:1, PROGRESS:100]`);
  log(`echo: ${input}`);
  process.exit(0);
}

main().catch((e) => {
  err('fatal: ' + (e && e.message ? e.message : String(e)));
  process.exit(2);
});