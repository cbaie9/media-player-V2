'use strict';

/**
 * Algorithme de suggestion de fin de comics (cf. §5 du CDC V1).
 *
 *  Entrée : comics courant C, dossier D (/comics/ ou /img/), série S
 *  Sortie : liste de 3 comics (ou moins) du MÊME dossier D de la MÊME série S
 *
 *  Étapes :
 *    1. Liste L = tous les comics de D (série S)
 *    2. Retirer C de L
 *    3. Si L vide → []
 *    4. Mélanger L (Fisher-Yates)
 *    5. Prendre les 3 premiers (ou tous si L < 3)
 *
 *  Contraintes :
 *    - Jamais de traversée /comics/ ↔ /img/
 *    - Jamais de traversée entre séries
 */

/**
 * Mélange un tableau en place (Fisher-Yates).
 * @template T
 * @param {T[]} arr
 * @param {() => number} [random=Math.random]
 * @returns {T[]} le tableau (mélangé en place)
 */
function shuffle(arr, random = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Sélectionne jusqu'à `count` éléments aléatoires de `arr`, en excluant
 * une valeur donnée (par identité de nom).
 *
 * @template T
 * @param {T[]} arr         - Liste complète des candidats
 * @param {(item: T) => boolean} exclude - Prédicat d'exclusion (le courant)
 * @param {number} [count=3]
 * @param {() => number} [random=Math.random]
 * @returns {T[]}
 */
function pickSuggestions(arr, exclude, count = 3, random = Math.random) {
  if (!Array.isArray(arr) || arr.length === 0) return [];

  // 1. Filtrer (retirer le courant)
  const pool = arr.filter((item) => !exclude(item));

  // 2. Rien à suggérer
  if (pool.length === 0) return [];

  // 3. Mélanger
  shuffle(pool, random);

  // 4. Prendre count (ou tout)
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Suggestion de haut niveau : à partir de la structure complète du store,
 * retourne 3 suggestions pour un comics donné.
 *
 * @param {object} params
 * @param {object} params.series     - Structure complète { serieName: { comics: [], img: [] } }
 * @param {string} params.serieName  - Nom de la série (lowercase)
 * @param {'comics'|'img'} params.folder - Dossier ciblé
 * @param {string} params.currentName - Nom du comics courant (pour exclusion)
 * @param {number} [params.count=3]
 * @param {() => number} [params.random]
 * @returns {Array<{ name: string, pageCount: number, cover: string|null }>}
 *
 * @throws {Error} si serieName inconnu ou folder invalide
 */
function suggestForComics({
  series,
  serieName,
  folder,
  currentName,
  count = 3,
  random = Math.random,
}) {
  if (!series || typeof series !== 'object') {
    throw new Error('suggestForComics: series est requis');
  }
  if (folder !== 'comics' && folder !== 'img') {
    throw new Error(`suggestForComics: folder invalide "${folder}"`);
  }

  const serie = series[serieName];
  if (!serie) {
    throw new Error(`suggestForComics: série inconnue "${serieName}"`);
  }

  const list = serie[folder] || [];

  const picks = pickSuggestions(
    list,
    (c) => c.name === currentName,
    count,
    random
  );

  // On normalise la sortie pour ne pas exposer la structure interne complète.
  // `cover` = premier fichier du comics (image ou video), ou null si aucune page.
  return picks.map((c) => ({
    name: c.name,
    pageCount: c.pages.length,
    cover: c.pages.length > 0 ? c.pages[0].file : null,
  }));
}

module.exports = {
  shuffle,
  pickSuggestions,
  suggestForComics,
};