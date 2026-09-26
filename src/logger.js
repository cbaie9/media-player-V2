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

module.exports = { Logger, readLog, LEVELS };