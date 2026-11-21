'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { requireAuth } = require('../auth');
const { safeResolveInfo, matchesPattern } = require('../security');
const { mimeFromExt } = require('../utils/mime');
const { parseFilename } = require('../utils/parseFilename');

const SERIE_RE = /^[a-z0-9_-]+$/;

/**
 * V1.2 — Whitelist étendue : 4 dossiers reconnus.
 *
 * Un reader qui demande un fichier dans un dossier `_admin` reçoit
 * un 404 (comme si le fichier n'existait pas) — la vérification est
 * faite juste après la validation du path.
 */
const FOLDER_ENUM = new Set([
  'comics',
  'comics_admin',
  'img',
  'img_admin',
]);

/**
 * V1.2 — Un folder est-il admin-only ?
 * @param {string} folder
 */
function isAdminFolder(folder) {
  return folder === 'comics_admin' || folder === 'img_admin';
}

/**
 * Parse un header Range: bytes=X-Y.
 * @param {string} header
 * @param {number} size
 * @returns {{ start: number, end: number } | null}
 */
function parseRange(header, size) {
  if (!header || typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s, e] = m;
  let start = s === '' ? null : parseInt(s, 10);
  let end = e === '' ? null : parseInt(e, 10);

  if (start === null && end === null) return null;
  if (start === null) {
    // bytes=-N : N derniers octets
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

/**
 * Récupère le rôle depuis la session, avec fallback safe.
 * @param {import('express').Request} req
 * @returns {'reader'|'admin'}
 */
function roleOf(req) {
  const user = (req.session && req.session.user) || null;
  if (user && user.role === 'admin') return 'admin';
  return 'reader';
}

/**
 * V1.5.3 — Résout (realName, realFile) pour reconstruire le chemin disque.
 *
 * Si `store` n'est pas fourni (tests legacy), fallback : on retourne
 * les valeurs lowercase telles que reçues dans l'URL.
 *
 * @param {object|null} store
 * @param {string} serie       - lowercase (URL)
 * @param {string} folder      - valeur URL
 * @param {{ name: string, page: number }} parsed - résultat de parseFilename
 * @param {string} file        - lowercase (URL)
 * @returns {{ ok: true, realName: string, realFile: string } | { ok: false }}
 */
function resolveRealPath(store, serie, folder, parsed, file) {
  if (!store) {
    return { ok: true, realName: serie, realFile: file };
  }

  const serieData = store.series && store.series[serie];
  if (!serieData) return { ok: false };

  const base =
    folder === 'comics' || folder === 'comics_admin' ? 'comics' : 'img';
  const comicsEntry = (serieData[base] || []).find(
    (c) => c.name === parsed.name && c.folder === folder
  );
  if (!comicsEntry) return { ok: false };

  const page = (comicsEntry.pages || []).find((p) => p.num === parsed.page);
  if (!page) return { ok: false };

  return {
    ok: true,
    realName: serieData.realName || serie,
    realFile: page.realFile || file,
  };
}

/**
 * Routeur média : /media/:serie/:folder/:file
 *
 * V1.2 :
 *   - accepte 4 folders
 *   - un reader sur un folder admin-only reçoit un 404
 *
 * V1.5.3 :
 *   - utilise `store` (optionnel) pour résoudre `realName` / `realFile`
 *     (casse réelle sur disque) — indispensable sur Linux quand les
 *     noms de dossier ou de fichier contiennent des majuscules.
 *   - le code de retour reflète précisément la cause d'échec :
 *       * not_found (ENOENT)   → 404 file_not_found
 *       * traversal (vrai)     → 403 forbidden + log
 *       * invalid (config/IO)  → 500 internal_error + log
 *
 * @param {object} params
 * @param {string} params.rootDir
 * @param {object} params.logger
 * @param {object} [params.store]   - Store pour le lookup realName/realFile
 * @returns {import('express').Router}
 */
function buildMediaRouter({ rootDir, logger, store }) {
  const router = express.Router();

  router.use(requireAuth());

  router.get('/:serie/:folder/:file', (req, res) => {
    const { serie, folder, file } = req.params;

    // Validation des segments
    if (!matchesPattern(serie, SERIE_RE)) {
      return res.status(404).json({ error: 'file_not_found' });
    }
    if (!FOLDER_ENUM.has(folder)) {
      return res.status(404).json({ error: 'file_not_found' });
    }

    // V1.2 — Contrôle d'accès : un reader ne doit même pas savoir que
    // le dossier admin existe. On répond 404 avant toute I/O disque.
    const role = roleOf(req);
    if (isAdminFolder(folder) && role !== 'admin') {
      if (logger) {
        logger.warn('media_admin_denied', {
          serie,
          folder,
          file,
          ip: req.ip,
          role,
        });
      }
      return res.status(404).json({ error: 'file_not_found' });
    }

    // Le nom de fichier doit respecter la regex A1
    const parsed = parseFilename(file);
    if (!parsed) {
      return res.status(404).json({ error: 'file_not_found' });
    }

    // V1.5.3 — Lookup realName / realFile via le store (si fourni).
    // Si l'entrée n'existe pas dans le cache → 404 (fichier non scanné).
    const resolved = resolveRealPath(store, serie, folder, parsed, file);
    if (!resolved.ok) {
      return res.status(404).json({ error: 'file_not_found' });
    }

    // Chemin relatif reconstruit (jamais depuis req.params brut)
    const relPath = path.join(
      resolved.realName,
      folder,
      resolved.realFile
    );
    const info = safeResolveInfo(rootDir, relPath);

    if (!info.ok) {
      if (info.reason === 'traversal') {
        if (logger) {
          logger.warn('path_traversal_blocked', {
            requested: relPath,
            ip: req.ip,
          });
        }
        return res.status(403).json({ error: 'forbidden' });
      }
      if (info.reason === 'invalid') {
        // Root inaccessible, null byte, params invalides… = erreur interne.
        if (logger) {
          logger.error('media_invalid_request', {
            requested: relPath,
            ip: req.ip,
          });
        }
        return res.status(500).json({ error: 'internal_error' });
      }
      // not_found : le fichier n'existe pas sur disque (cache obsolète,
      // renommage entre scan et requête, etc.). Pas de fuite d'info.
      return res.status(404).json({ error: 'file_not_found' });
    }

    const absPath = info.path;

    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch {
      return res.status(404).json({ error: 'file_not_found' });
    }
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'file_not_found' });
    }

    const mime = mimeFromExt(parsed.ext);
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const range = parseRange(req.headers.range, stat.size);

    if (!range) {
      // Réponse complète
      res.setHeader('Content-Length', String(stat.size));
      if (logger) {
        logger.info('media_served', {
          serie,
          folder,
          file,
          bytes: stat.size,
          ranged: false,
        });
      }
      return fs.createReadStream(absPath).pipe(res);
    }

    // Partial Content
    const { start, end } = range;
    const length = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(length));

    if (logger) {
      logger.info('media_served', {
        serie,
        folder,
        file,
        bytes: length,
        ranged: true,
      });
    }

    return fs.createReadStream(absPath, { start, end }).pipe(res);
  });

  return router;
}

module.exports = { buildMediaRouter, parseRange };