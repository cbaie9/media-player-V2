'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Vérifie qu'un chemin résolu reste bien à l'intérieur de `rootDir`,
 * et retourne la raison précise en cas d'échec.
 *
 * - Résout les symlinks via `fs.realpathSync` (R3) pour éviter les
 *   évasions via lien symbolique.
 * - Si le chemin cible n'existe pas, on tente de résoudre le dossier
 *   parent.
 * - Distingue explicitement trois cas d'échec :
 *     * 'not_found'  : le chemin (ou son parent) n'existe pas sur disque
 *     * 'traversal'  : le chemin sort de `rootDir` (ou via symlink)
 *     * 'invalid'    : entrée invalide (non-string, null byte, root cassé)
 *
 * V1.5.3 — retourne un objet discriminant au lieu de `string|null`.
 * Voir `safeResolve` (wrapper rétrocompatible) pour l'ancienne API.
 *
 * @param {string} rootDir - Racine absolue (déjà résolue)
 * @param {string} candidatePath - Chemin à tester (peut être relatif)
 * @returns {{ ok: true, path: string } | { ok: false, reason: 'not_found' | 'traversal' | 'invalid' }}
 */
function safeResolveInfo(rootDir, candidatePath) {
  if (typeof rootDir !== 'string' || typeof candidatePath !== 'string') {
    return { ok: false, reason: 'invalid' };
  }

  // Rejette d'emblée les null bytes (path injection)
  if (candidatePath.includes('\0')) {
    return { ok: false, reason: 'invalid' };
  }

  const absRoot = path.resolve(rootDir);

  // Résolution des symlinks du root (une fois)
  let realRoot;
  try {
    realRoot = fs.realpathSync(absRoot);
  } catch {
    // Root inaccessible : erreur de configuration, pas un traversal.
    return { ok: false, reason: 'invalid' };
  }

  const absTarget = path.resolve(realRoot, candidatePath);
  const withSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;

  // Pré-check lexical : détecte les traversals même quand la cible
  // n'existe pas sur disque (ex : "../../etc/passwd" vers un fichier
  // inexistant doit rester un traversal, pas un not_found).
  if (absTarget !== realRoot && !absTarget.startsWith(withSep)) {
    return { ok: false, reason: 'traversal' };
  }

  // Résolution du realpath de la cible
  let realTarget;
  try {
    realTarget = fs.realpathSync(absTarget);
  } catch {
    // La cible n'existe pas : on résout son parent.
    const parent = path.dirname(absTarget);
    let realParent;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      // Ni la cible ni son parent n'existent : not_found.
      // (Un traversal pur a déjà été attrapé par le pré-check.)
      return { ok: false, reason: 'not_found' };
    }
    realTarget = path.join(realParent, path.basename(absTarget));
  }

  // Vérification finale : le chemin réel doit être sous realRoot.
  // (Attrape les symlinks sortants, cf. R3.)
  if (realTarget === realRoot) {
    return { ok: true, path: realTarget };
  }
  if (!realTarget.startsWith(withSep)) {
    return { ok: false, reason: 'traversal' };
  }

  return { ok: true, path: realTarget };
}

/**
 * Vérifie qu'un chemin résolu reste bien à l'intérieur de `rootDir`.
 *
 * Wrapper rétrocompatible autour de `safeResolveInfo` : retourne le
 * chemin résolu si OK, `null` sinon (quelle que soit la raison).
 *
 * ⚠️ Pour distinguer `not_found` de `traversal`, utiliser
 * `safeResolveInfo` directement (cas de `routes/media.js`).
 *
 * @param {string} rootDir - Racine absolue (déjà résolue)
 * @param {string} candidatePath - Chemin à tester (peut être relatif)
 * @returns {string|null}
 */
function safeResolve(rootDir, candidatePath) {
  const info = safeResolveInfo(rootDir, candidatePath);
  return info.ok ? info.path : null;
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
  safeResolveInfo,
  parseSafeSegments,
  matchesPattern,
  LoginRateLimiter,
};