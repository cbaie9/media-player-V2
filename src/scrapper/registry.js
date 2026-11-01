'use strict';

/**
 * Registry des runs Scrapper actifs (V1.5).
 *
 * Responsabilités :
 *   - Suivre les runs en cours par `runId` et par `sessionId`
 *   - Appliquer les limites de concurrence (D6) :
 *       • `max_concurrent_per_session` (défaut 1)
 *       • `max_concurrent_global`      (défaut 3)
 *   - Nettoyer automatiquement à la fin d'un run (`run.onDone`)
 *   - Permettre un kill global au shutdown du serveur (`killAll`)
 *
 * ⚠️ Dépendance circulaire évitée : `runner.js` n'est PAS importé au
 * chargement. On utilise un **lazy require** (ou une factory injectée
 * pour les tests) qui ne s'exécute qu'à la première création de run.
 * Conséquence : `registry.js` peut être chargé/require avant que
 * `runner.js` n'existe sur le disque (utile pour les lots 2 et 3,
 * et pour les tests unitaires isolés).
 *
 * Aucun log ici : c'est le `Run` qui émet les événements `scrapper_*`.
 */

// ---------------------------------------------------------------------------
// Factory de Run (lazy + injectable)
// ---------------------------------------------------------------------------

/** @type {null | ((args: {input: string, sessionId: string, cfg: object}) => object)} */
let _RunnerFactory = null;

/**
 * Injecte une factory de Run (tests unitaires, ou init explicite).
 * @param {Function|null} factory
 */
function setRunnerFactory(factory) {
  _RunnerFactory = factory;
}

/**
 * Récupère la factory active (injectée ou par lazy require de runner.js).
 * @returns {Function}
 */
function getRunnerFactory() {
  if (_RunnerFactory) return _RunnerFactory;
  // Lazy require : n'échoue QUE si on tente de créer un run sans que
  // runner.js soit présent. Le message d'erreur est explicite.
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

/**
 * Compte les runs actifs pour une session.
 * @param {string} sessionId
 * @returns {number}
 */
function countForSession(sessionId) {
  const set = bySession.get(sessionId);
  return set ? set.size : 0;
}

/**
 * Compte le nombre total de runs actifs.
 * @returns {number}
 */
function total() {
  return runs.size;
}

/**
 * Crée et enregistre un nouveau run.
 *
 * ⚠️ Ne démarre PAS le run (c'est `run.start()` qui s'en charge, côté
 * route). Cette séparation permet à la route d'attacher `res` avant
 * que les premiers événements ne soient émis.
 *
 * @param {object} params
 * @param {string} params.input
 * @param {string} params.sessionId
 * @param {object} params.cfg - Bloc `python_module` validé
 * @returns {object} L'instance de Run (typiquement `Run`)
 */
function create({ input, sessionId, cfg }) {
  const RunnerFactory = getRunnerFactory();
  const run = new RunnerFactory({ input, sessionId, cfg });

  if (!run || typeof run.start !== 'function') {
    throw new Error(
      "La factory de Run n'a pas retourné un objet valide (start() manquant)."
    );
  }

  runs.set(run.id, run);
  if (!bySession.has(sessionId)) bySession.set(sessionId, new Set());
  bySession.get(sessionId).add(run.id);

  // Nettoyage automatique à la fin du run.
  // On chaîne un callback utilisateur si présent, sans l'écraser.
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

/**
 * Récupère un run par id.
 * @param {string} runId
 * @returns {object | undefined}
 */
function get(runId) {
  return runs.get(runId);
}

/**
 * Récupère tous les runs d'une session.
 * @param {string} sessionId
 * @returns {object[]}
 */
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

/**
 * Tue tous les runs actifs (appelé au shutdown du serveur).
 * @param {string} [reason='shutdown']
 * @returns {number} Nombre de runs pour lesquels un kill a été demandé
 */
function killAll(reason = 'shutdown') {
  let count = 0;
  for (const run of runs.values()) {
    if (typeof run.kill === 'function' && !run.finished) {
      try {
        run.kill(reason);
        count += 1;
      } catch {
        /* silencieux : un run cassé ne doit pas bloquer le shutdown */
      }
    }
  }
  return count;
}

/**
 * Retourne un instantané de l'état (debug / tests / log périodique).
 * @returns {{ total: number, sessions: number, runIds: string[] }}
 */
function stats() {
  return {
    total: runs.size,
    sessions: bySession.size,
    runIds: [...runs.keys()],
  };
}

/**
 * Réinitialise complètement l'état (tests uniquement).
 * ⚠️ Ne tue PAS les runs : à réserver aux tests unitaires isolés.
 * @internal
 */
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