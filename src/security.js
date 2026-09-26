'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Vérifie qu'un chemin résolu reste bien à l'intérieur de `rootDir`.
 *
 * - Résout les symlinks via `fs.realpathSync` (R3) pour éviter les
 *   évasions via lien symbolique.
 * - Si le chemin cible n'existe pas, on tente de résoudre le dossier
 *   parent ; si celui-ci n'existe pas non plus, on refuse.
 * - Retourne le chemin réel résolu si OK, `null` sinon.
 *
 * @param {string} rootDir - Racine absolue (déjà résolue)
 * @param {string} candidatePath - Chemin à tester (peut être relatif)
 * @returns {string|null}
 */
function safeResolve(rootDir, candidatePath) {
  if (typeof rootDir !== 'string' || typeof candidatePath !== 'string') {
    return null;
  }

  // Rejette d'emblée les null bytes (path injection)
  if (candidatePath.includes('\0')) return null;

  const absRoot = path.resolve(rootDir);

  // Résolution des symlinks du root (une fois)
  let realRoot;
  try {
    realRoot = fs.realpathSync(absRoot);
  } catch {
    return null;
  }

  // On cherche d'abord le realpath de la cible
  const absTarget = path.resolve(realRoot, candidatePath);

  let realTarget;
  try {
    realTarget = fs.realpathSync(absTarget);
  } catch {
    // La cible n'existe pas : on résout son parent
    const parent = path.dirname(absTarget);
    let realParent;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      return null;
    }
    realTarget = path.join(realParent, path.basename(absTarget));
  }

  // Vérification : le chemin cible doit être sous realRoot
  const withSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realTarget === realRoot) return realTarget; // le dossier racine lui-même
  if (!realTarget.startsWith(withSep)) return null;

  return realTarget;
}

/**
 * Construit la liste des segments sûrs d'un chemin relatif.
 * Rejette les segments vides, ".", "..", et les séparateurs.
 *
 * @param {string} value
 * @returns {string[]|null}
 */
function parseSafeSegments(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  // Interdit les séparateurs et remontées
  if (value.includes('/') || value.includes('\\')) return null;
  if (value === '.' || value === '..') return null;
  if (value.includes('\0')) return null;
  return [value];
}

/**
 * Vérifie qu'une valeur respecte un pattern (ex: [a-z0-9_-]+).
 * @param {string} value
 * @param {RegExp} re
 */
function matchesPattern(value, re) {
  return typeof value === 'string' && re.test(value);
}

// -----------------------------------------------------------------------------
// Rate limiting (E2) : 5 tentatives / 15 min / IP, reset au login réussi
// -----------------------------------------------------------------------------

/**
 * Rate limiter simple, en mémoire.
 *
 * - Clé = identifiant (typiquement l'IP).
 * - Fenêtre glissante fixe (windowMs).
 * - Reset complet au succès (méthode `reset`).
 */
class LoginRateLimiter {
  /**
   * @param {object} opts
   * @param {number} [opts.windowMs=900000]  - Fenêtre en ms (15 min par défaut)
   * @param {number} [opts.maxAttempts=5]
   * @param {() => number} [opts.now]        - Horloge injectable (tests)
   */
  constructor(opts = {}) {
    this.windowMs = opts.windowMs ?? 15 * 60 * 1000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.now = opts.now ?? Date.now;
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.buckets = new Map();
  }

  /**
   * Enregistre une tentative et indique si elle est autorisée.
   *
   * @param {string} key
   * @returns {{ allowed: boolean, retryAfterSeconds: number, remaining: number }}
   */
  register(key) {
    const now = this.now();
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > this.maxAttempts) {
      const retryAfterSeconds = Math.max(
        0,
        Math.ceil((bucket.resetAt - now) / 1000)
      );
      return {
        allowed: false,
        retryAfterSeconds,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: this.maxAttempts - bucket.count,
    };
  }

  /**
   * Retourne l'état sans incrémenter (utile pour vérifier avant).
   * @param {string} key
   */
  peek(key) {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      return { allowed: true, retryAfterSeconds: 0, remaining: this.maxAttempts };
    }
    if (bucket.count >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: this.maxAttempts - bucket.count,
    };
  }

  /**
   * Reset le compteur pour une clé (appelé au login réussi).
   * @param {string} key
   */
  reset(key) {
    this.buckets.delete(key);
  }

  /**
   * Purge les entrées expirées (utile pour éviter la fuite mémoire).
   */
  cleanup() {
    const now = this.now();
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k);
    }
  }
}

module.exports = {
  safeResolve,
  parseSafeSegments,
  matchesPattern,
  LoginRateLimiter,
};