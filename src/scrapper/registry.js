'use strict';

/**
 * Registry des runs Scrapper actifs (V1.5).
 */

// ---------------------------------------------------------------------------
// Factory de Run (lazy + injectable)
// ---------------------------------------------------------------------------

/** @type {null | Function} */
let _RunnerFactory = null;

/**
 * Injecte une factory de Run (tests unitaires, ou init explicite).
 *
 * Accepte :
 *   - une classe (utilise `new`)
 *   - une arrow function / fonction "factory" (appel direct)
 *
 * @param {Function|null} factory
 */
function setRunnerFactory(factory) {
  _RunnerFactory = factory;
}

/**
 * Détermine si `fn` est une classe ES6.
 * Les classes ont un `Function.prototype.toString` qui commence par
 * `class`. Les fonctions classiques et les arrow functions sont
 * appelables directement.
 *
 * @param {Function} fn
 * @returns {boolean}
 */
function isClass(fn) {
  if (typeof fn !== 'function') return false;
  try {
    return /^class[\s{]/.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

/**
 * Instancie un Run via la factory, en respectant son type
 * (classe vs factory).
 *
 * @param {Function} factory
 * @param {object} args
 * @returns {object}
 */
function instantiateRun(factory, args) {
  if (isClass(factory)) {
    return new factory(args);
  }
  return factory(args);
}

/**
 * Récupère la factory active (injectée ou par lazy require de runner.js).
 * @returns {Function}
 */
function getRunnerFactory() {
  if (_RunnerFactory) return _RunnerFactory;
  try {
    const { Run } = require('./runner');
    if (typeof Run !== 'function') {
      throw new Error("runner.js ne contient pas d'export 'Run'");
    }
    _RunnerFactory = Run;
    return Run;
  } catch (err) {
    throw new Error(
      `Impossible de charger le runner Scrapper : ${err.message}. ` +
        'Le Lot 3 (src/scrapper/runner.js) doit être présent.'
    );
  }
}

// ---------------------------------------------------------------------------
// État interne
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} runId → Run */
const runs = new Map();

/** @type {Map<string, Set<string>>} sessionId → Set<runId> */
const bySession = new Map();

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

function countForSession(sessionId) {
  const set = bySession.get(sessionId);
  return set ? set.size : 0;
}

function total() {
  return runs.size;
}

/**
 * Crée et enregistre un nouveau run.
 *
 * @param {object} params
 * @param {string} params.input
 * @param {string} params.sessionId
 * @param {object} params.cfg
 * @returns {object} L'instance de Run
 */
function create({ input, sessionId, cfg }) {
  const RunnerFactory = getRunnerFactory();
  const run = instantiateRun(RunnerFactory, { input, sessionId, cfg });

  if (!run || typeof run.start !== 'function') {
    throw new Error(
      "La factory de Run n'a pas retourné un objet valide (start() manquant)."
    );
  }

  runs.set(run.id, run);
  if (!bySession.has(sessionId)) bySession.set(sessionId, new Set());
  bySession.get(sessionId).add(run.id);

  const userOnDone = run.onDone;
  run.onDone = (finishedRun) => {
    try {
      if (typeof userOnDone === 'function') userOnDone(finishedRun);
    } finally {
      runs.delete(finishedRun.id);
      const set = bySession.get(sessionId);
      if (set) {
        set.delete(finishedRun.id);
        if (set.size === 0) bySession.delete(sessionId);
      }
    }
  };

  return run;
}

function get(runId) {
  return runs.get(runId);
}

function listForSession(sessionId) {
  const set = bySession.get(sessionId);
  if (!set) return [];
  const out = [];
  for (const id of set) {
    const run = runs.get(id);
    if (run) out.push(run);
  }
  return out;
}

function killAll(reason = 'shutdown') {
  let count = 0;
  for (const run of runs.values()) {
    if (typeof run.kill === 'function' && !run.finished) {
      try {
        run.kill(reason);
        count += 1;
      } catch {
        /* silencieux */
      }
    }
  }
  return count;
}

function stats() {
  return {
    total: runs.size,
    sessions: bySession.size,
    runIds: [...runs.keys()],
  };
}

function __resetForTests() {
  runs.clear();
  bySession.clear();
  _RunnerFactory = null;
}

module.exports = {
  // Factory
  setRunnerFactory,
  getRunnerFactory,
  // Query
  countForSession,
  total,
  get,
  listForSession,
  stats,
  // Lifecycle
  create,
  killAll,
  // Tests
  __resetForTests,
};