'use strict';

/**
 * thumb.js — extraction de vignettes vidéo côté client (V1.1, B).
 *
 * - <video preload="metadata"> + <canvas> → Blob JPEG (B2)
 * - Cache Storage API 'media-thumbs-v1' (B3)
 * - Clé = URL relative du fichier vidéo (B4)
 * - Max 320 px de large, ratio conservé (B6)
 * - Frame à currentTime = 0 (B7)
 * - File d'attente séquentielle (B9)
 * - Timeout 3 s sur loadeddata → placeholder (B16)
 * - Cache limité à 500 entrées, éviction FIFO (B17)
 *
 * Expose window.thumb avec :
 *   - getThumbUrl(videoUrl, relativeKey) : Promise<string|null>
 *   - placeholderDataUrl() : string (SVG ▶)
 *   - stats : { pending, extracted, cached, failed, queued }
 */
(function () {
  const CACHE_NAME = 'media-thumbs-v1';
  const MAX_WIDTH = 320;
  const JPEG_QUALITY = 0.8;
  const LOADEDDATA_TIMEOUT_MS = 3000;
  const MAX_ENTRIES = 500;

  /** URL relative → blob: URL (déjà extraite dans cette session) */
  const memCache = new Map();

  /** File d'attente séquentielle (B9) : 1 extraction à la fois. */
  const queue = [];
  let running = false;

  /** Compteurs exposés pour les tests E2E (F7). */
  const stats = {
    pending: 0,   // extractions en attente ou en cours
    extracted: 0, // extractions réussies
    cached: 0,    // hits cache (mémoire + Cache Storage)
    failed: 0,    // échecs (fallback placeholder)
    queued: 0,    // total entré dans la file (monotone)
  };

  /** Support Cache Storage ? (evergreen OK, mais on sécurise) */
  const hasCacheStorage =
    typeof caches !== 'undefined' && typeof caches.open === 'function';

  /** Support <video> + canvas.toBlob ? */
  const hasVideo =
    typeof document !== 'undefined' &&
    !!document.createElement('video').canPlayType;

  // -------------------------------------------------------------------------
  // Placeholder SVG ▶ (B11/B12)
  // -------------------------------------------------------------------------
  let placeholderUrl = null;
  function placeholderDataUrl() {
    if (placeholderUrl) return placeholderUrl;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" ' +
      'viewBox="0 0 200 280">' +
      '<rect width="100%" height="100%" fill="#2a2a2e"/>' +
      '<circle cx="100" cy="120" r="36" fill="rgba(255,255,255,0.12)"/>' +
      '<polygon points="88,100 88,140 122,120" fill="#e8e8ec"/>' +
      '<text x="50%" y="200" fill="#8a8a92" font-family="system-ui" ' +
      'font-size="14" text-anchor="middle">vidéo</text>' +
      '</svg>';
    placeholderUrl =
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return placeholderUrl;
  }

  // -------------------------------------------------------------------------
  // File d'attente séquentielle (B9)
  // -------------------------------------------------------------------------
  function enqueue(task) {
    stats.pending++;
    stats.queued++;
    queue.push(task);
    if (!running) drain();
  }

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const task = queue.shift();
      try {
        await task();
      } catch (err) {
        // Ne jamais bloquer la file à cause d'une tâche
        // (chaque task gère déjà son propre fallback).
        if (typeof console !== 'undefined') {
          console.warn('[thumb] task error:', err && err.message);
        }
      } finally {
        stats.pending--;
      }
    }
    running = false;
  }

  // -------------------------------------------------------------------------
  // Cache Storage (B3/B4/B17)
  // -------------------------------------------------------------------------

  /**
   * Construit une Request unique pour une clé de cache.
   * On utilise une URL synthétique pour ne pas dépendre du domaine courant.
   * Le "pathname" est la clé relative passée par l'appelant.
   */
  function cacheRequest(key) {
    // Clé normalisée, sans slash initial pour éviter les surprises.
    const safeKey = String(key).replace(/^\/+/, '');
    return new Request('https://media-thumbs.local/' + safeKey, {
      method: 'GET',
    });
  }

  async function cacheGet(key) {
    if (!hasCacheStorage) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(cacheRequest(key));
      if (!res) return null;
      const blob = await res.blob();
      return blob;
    } catch {
      return null;
    }
  }

  async function cachePut(key, blob) {
    if (!hasCacheStorage) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        cacheRequest(key),
        new Response(blob, {
          headers: {
            'Content-Type': 'image/jpeg',
            'X-Thumb-Created': String(Date.now()),
          },
        })
      );
      await enforceCacheLimit(cache);
    } catch {
      // Échec silencieux : le cache n'est qu'une optimisation
    }
  }

  /**
   * B17 : limite à 500 entrées, éviction FIFO.
   * On se base sur un header X-Thumb-Created pour l'ordre d'insertion.
   */
  async function enforceCacheLimit(cache) {
    try {
      const keys = await cache.keys();
      if (keys.length <= MAX_ENTRIES) return;

      // Récupère toutes les entrées avec leur date de création
      const entries = [];
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const created = parseInt(res.headers.get('X-Thumb-Created') || '0', 10);
        entries.push({ req, created });
      }

      // Trie FIFO (les plus anciennes d'abord)
      entries.sort((a, b) => a.created - b.created);

      // Supprime jusqu'à redescendre à MAX_ENTRIES
      const toDelete = entries.length - MAX_ENTRIES;
      for (let i = 0; i < toDelete; i++) {
        await cache.delete(entries[i].req);
      }
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // Extraction d'une frame (B2/B5/B6/B7/B16)
  // -------------------------------------------------------------------------

  /**
   * Charge une vidéo avec preload=metadata, attend loadeddata (ou timeout),
   * dessine la frame à currentTime=0 dans un canvas, et retourne un Blob JPEG.
   *
   * @param {string} videoUrl
   * @returns {Promise<Blob>}
   */
  function extractFrame(videoUrl) {
    return new Promise((resolve, reject) => {
      if (!hasVideo) {
        reject(new Error('video_unsupported'));
        return;
      }

      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.src = videoUrl;

      let settled = false;

      const cleanup = () => {
        video.removeAttribute('src');
        try { video.load(); } catch { /* ignore */ }
      };

      const fail = (reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        cleanup();
        reject(new Error(reason));
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

        try {
          const vw = video.videoWidth || 0;
          const vh = video.videoHeight || 0;
          if (vw === 0 || vh === 0) {
            cleanup();
            reject(new Error('no_video_dimensions'));
            return;
          }

          // B6 : max 320 px de large, ratio conservé
          const scale = vw > MAX_WIDTH ? MAX_WIDTH / vw : 1;
          const w = Math.max(1, Math.round(vw * scale));
          const h = Math.max(1, Math.round(vh * scale));

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');

          // B7 : currentTime = 0
          try {
            video.currentTime = 0;
          } catch {
            // Safari peut throw sur certains codecs, on continue
          }

          ctx.drawImage(video, 0, 0, w, h);

          canvas.toBlob(
            (blob) => {
              cleanup();
              if (!blob) {
                reject(new Error('toBlob_failed'));
                return;
              }
              resolve(blob);
            },
            'image/jpeg',
            JPEG_QUALITY
          );
        } catch (err) {
          cleanup();
          reject(err instanceof Error ? err : new Error('canvas_error'));
        }
      };

      // B16 : timeout 3 s sur loadeddata → placeholder (Safari iOS)
      const timeoutId = setTimeout(() => {
        fail('loadeddata_timeout');
      }, LOADEDDATA_TIMEOUT_MS);

      video.addEventListener('loadeddata', succeed, { once: true });
      video.addEventListener('error', () => fail('video_error'), { once: true });
      video.addEventListener('abort', () => fail('video_abort'), { once: true });
    });
  }

  // -------------------------------------------------------------------------
  // API publique
  // -------------------------------------------------------------------------

  /**
   * Retourne une URL (blob:) vers la vignette extraite, ou null si échec.
   *
   * B4 : la clé de cache est l'URL RELATIVE du fichier vidéo
   * (ex: "serie_a/comics/comics_a-0003.mp4"), indépendante du contexte.
   * B18 : réutilisation entre onglets Comics / Images.
   *
   * @param {string} videoUrl      - URL absolue utilisée pour <video src>
   * @param {string} relativeKey   - Clé de cache (URL relative)
   * @returns {Promise<string|null>} blob: URL, ou null si échec
   */
  async function getThumbUrl(videoUrl, relativeKey) {
    const key = String(relativeKey || videoUrl);

    // 1. Cache mémoire
    if (memCache.has(key)) {
      stats.cached++;
      return memCache.get(key);
    }

    // 2. Cache Storage
    const cachedBlob = await cacheGet(key);
    if (cachedBlob) {
      const url = URL.createObjectURL(cachedBlob);
      memCache.set(key, url);
      stats.cached++;
      return url;
    }

    // 3. Extraction (séquentielle)
    return new Promise((resolve) => {
      enqueue(async () => {
        try {
          const blob = await extractFrame(videoUrl);
          await cachePut(key, blob);
          const url = URL.createObjectURL(blob);
          memCache.set(key, url);
          stats.extracted++;
          resolve(url);
        } catch (err) {
          stats.failed++;
          if (typeof console !== 'undefined') {
            console.warn('[thumb] extraction failed for', key, err && err.message);
          }
          resolve(null); // → l'appelant utilisera le placeholder
        }
      });
    });
  }

  /**
   * Récupère uniquement depuis le cache (synchrone + Storage).
   * Utile pour les tests.
   */
  async function peek(key) {
    if (memCache.has(key)) return memCache.get(key);
    const blob = await cacheGet(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    memCache.set(key, url);
    return url;
  }

  window.thumb = {
    getThumbUrl,
    peek,
    placeholderDataUrl,
    stats,
    // Exposé pour les tests E2E (F7)
    _internal: { CACHE_NAME, MAX_WIDTH, MAX_ENTRIES, LOADEDDATA_TIMEOUT_MS },
  };
})();