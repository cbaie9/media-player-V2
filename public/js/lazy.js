'use strict';

/**
 * lazy.js — IntersectionObserver pour lazy-loading (V1.1, E7).
 *
 * Expose :
 *   - window.lazyObserve(root)        : lazy-load <img data-src>
 *   - window.observeVideoThumb(videoEl) : déclenche l'extraction d'une
 *                                        vignette vidéo à l'entrée dans
 *                                        le viewport (B8), via thumb.js.
 */
(function () {
  // --- Fallback sans IntersectionObserver ---------------------------------
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('img[data-src]').forEach((img) => {
      img.src = img.dataset.src;
    });
    window.lazyObserve = function () {};

    // Fallback thumb : extraction immédiate (pas de lazy)
    window.observeVideoThumb = function (videoEl) {
      if (!videoEl) return;
      const url = videoEl.dataset.videoUrl;
      const key = videoEl.dataset.videoKey || url;
      const img = videoEl;
      if (!url || !window.thumb) return;
      img.dataset.thumbState = 'loading';
      window.thumb.getThumbUrl(url, key).then((thumbUrl) => {
        if (thumbUrl) {
          img.src = thumbUrl;
          img.dataset.thumbState = 'ready';
        } else {
          img.src = window.api
            ? window.api.videoPlaceholder()
            : window.thumb.placeholderDataUrl();
          img.dataset.thumbState = 'failed';
        }
        img.removeAttribute('data-video-url');
        img.removeAttribute('data-video-key');
      });
    };
    return;
  }

  // --- Observer des <img data-src> ----------------------------------------
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const img = e.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          io.unobserve(img);
        }
      }
    },
    { rootMargin: '200px' }
  );

  window.lazyObserve = function (root) {
    const scope = root || document;
    scope.querySelectorAll('img[data-src]').forEach((img) => io.observe(img));
  };

  // --- Observer des <img data-video-url> (vignettes vidéo) ----------------
  // Élément clé : on utilise un <img> placeholder en attendant la vignette.
  // L'attribut data-video-url porte l'URL absolue de la vidéo,
  // data-video-key porte la clé relative de cache (B4).
  const ioThumb = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        const videoUrl = img.dataset.videoUrl;
        const key = img.dataset.videoKey || videoUrl;
        ioThumb.unobserve(img);

        if (!videoUrl || !window.thumb) {
          img.src = window.api
            ? window.api.videoPlaceholder()
            : (window.thumb && window.thumb.placeholderDataUrl
                ? window.thumb.placeholderDataUrl()
                : img.src);
          return;
        }

        img.dataset.thumbState = 'loading';
        window.thumb.getThumbUrl(videoUrl, key).then((thumbUrl) => {
          if (thumbUrl) {
            img.src = thumbUrl;
            img.dataset.thumbState = 'ready';
          } else {
            img.src = window.api
              ? window.api.videoPlaceholder()
              : window.thumb.placeholderDataUrl();
            img.dataset.thumbState = 'failed';
          }
          img.removeAttribute('data-video-url');
          img.removeAttribute('data-video-key');
        });
      }
    },
    { rootMargin: '200px' }
  );

  /**
   * V1.1 — E7 : observe un <img> placeholder vidéo.
   * @param {HTMLImageElement} imgEl
   */
  window.observeVideoThumb = function (imgEl) {
    if (!imgEl || !(imgEl instanceof HTMLElement)) return;
    ioThumb.observe(imgEl);
  };
})();