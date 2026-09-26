'use strict';

(function () {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('img[data-src]').forEach((img) => {
      img.src = img.dataset.src;
    });
    window.lazyObserve = function () {};
    return;
  }

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
})();