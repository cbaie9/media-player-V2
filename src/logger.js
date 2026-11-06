'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Niveaux de log autorisés (cf. §4.2).
 * @type {ReadonlyArray<string>}
 */
const LEVELS = Object.freeze(['info', 'warn', 'error']);

/**
 * Logger JSON Lines (une ligne = un objet JSON) — cf. §4.2.
 *
 * Caractéristiques :
 *  - Append-only
 *  - Crée le dossier parent si absent
 *  - Thread-safe au niveau process Node (appendFileSync sérialise)
 *  - Ne throw JAMAIS : une erreur d'écriture est avalée (mais loggée
 *    sur stderr) pour ne pas faire tomber l'app.
 */
class Logger {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - Chemin absolu du fichier app.jsonl
   * @param {() => Date} [opts.now] - Horloge injectable (tests)
   * @param {NodeJS.WritableStream} [opts.stderr] - Flux d'erreur injectable
   */
  constructor(opts) {
    if (!opts || !opts.filePath) {
      throw new Error('Logger: filePath est requis');
    }
    this.filePath = opts.filePath;
    this.now = opts.now || (() => new Date());
    this.stderr = opts.stderr || process.stderr;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  /**
   * Écrit un événement.
   * @param {'info'|'warn'|'error'} level
   * @param {string} event
   * @param {object} [fields] - Champs additionnels (seront fusionnés)
   */
  log(level, event, fields = {}) {
    if (!LEVELS.includes(level)) {
      // On n'écrit pas un niveau invalide : on le downgrade
      fields = { ...fields, _invalidLevel: level };
      level = 'warn';
    }

    const entry = {
      ts: this.now().toISOString(),
      level,
      event,
      ...fields,
    };

    let line;
    try {
      line = JSON.stringify(entry) + '\n';
    } catch (err) {
      // Cas pathologique : cycles dans fields
      this.stderr.write(`[logger] JSON.stringify a échoué: ${err.message}\n`);
      return;
    }

    try {
      fs.appendFileSync(this.filePath, line, { encoding: 'utf8' });
    } catch (err) {
      // Ne jamais faire crasher l'app pour un log raté
      this.stderr.write(`[logger] Écriture impossible: ${err.message}\n`);
    }
  }

  info(event, fields) {
    this.log('info', event, fields);
  }
  warn(event, fields) {
    this.log('warn', event, fields);
  }
  error(event, fields) {
    this.log('error', event, fields);
  }
}

/**
 * Lit un fichier JSONL et retourne les entrées parsées.
 * Utile pour les tests et pour un éventuel tail.
 *
 * @param {string} filePath
 * @returns {Array<object>}
 */
function readLog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Ligne corrompue : ignorée
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Singleton + helper `logEvent` (V1.5)
//
// Motivation : les modules de la V1.5 (src/scrapper/*) ne reçoivent pas
// d'instance Logger en paramètre. On expose un logger par défaut,
// lazily-initialisé à partir de `getConfig().APP_LOG_FILE`.
// 100 % rétrocompatible : `Logger`, `readLog`, `LEVELS` inchangés.
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..');

let _defaultLogger = null;

/**
 * Définit le logger utilisé par `logEvent()`.
 * @param {Logger|null} logger
 */
function setDefaultLogger(logger) {
  _defaultLogger = logger;
}

/**
 * Récupère le logger par défaut (peut être null).
 * @returns {Logger|null}
 */
function getDefaultLogger() {
  return _defaultLogger;
}

/**
 * Log un événement via le logger par défaut.
 * No-op silencieux si la config n'est pas disponible.
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} event
 * @param {object} [fields]
 */
function logEvent(level, event, fields = {}) {
  if (_defaultLogger) {
    _defaultLogger.log(level, event, fields);
    return;
  }

  // Lazy-init à partir de la config courante
  try {
    // require différé pour éviter les cycles config ↔ logger
    const { getConfig } = require('./config');
    const cfg = getConfig();
    const appLogFile = path.resolve(PROJECT_ROOT, cfg.APP_LOG_FILE);
    _defaultLogger = new Logger({ filePath: appLogFile });
    _defaultLogger.log(level, event, fields);
  } catch (err) {
    // Config pas encore chargée ou APP_LOG_FILE introuvable :
    // on retombe sur stderr pour ne rien perdre.
    try {
      const fieldsStr =
        fields && Object.keys(fields).length > 0
          ? ' ' + JSON.stringify(fields)
          : '';
      process.stderr.write(`[logger-fallback] ${level}: ${event}${fieldsStr}\n`);
    } catch {
      /* vraiment rien à faire */
    }
  }
}

/**
 * Réinitialise le singleton (uniquement pour les tests).
 * @internal
 */
function __resetLoggerForTests() {
  _defaultLogger = null;
}

module.exports = {
  Logger,
  readLog,
  LEVELS,
  logEvent,
  setDefaultLogger,
  getDefaultLogger,
  __resetLoggerForTests,
};