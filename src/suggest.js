'use strict';

/**
 * Algorithme de suggestion de fin de comics (cf. §5 du CDC V1,
 * étendu V1.2).
 *
 *  Entrée : comics courant C (folder F, name N), série S, rôle R
 *  Sortie : liste de 6 comics (ou moins) de la MÊME série S,
 *           dans la MÊME base de dossier que C
 *           (base 'comics' si C est dans 'comics' ou 'comics_admin',
 *            base 'img'    si C est dans 'img'    ou 'img_admin')
 *
 *  V1.2 — Règles de visibilité :
 *    - reader : pool = uniquement le folder normal ('comics' ou 'img')
 *    - admin  : pool = folder normal + folder admin
 *               (les 2 dossiers se recommandent entre eux)
 *
 *  Étapes :
 *    1. Construire le pool P = comics de la série S dans la base B,
 *       filtrés selon le rôle
 *    2. Retirer C de P (par identité (folder, name))
 *    3. Si P vide → []
 *    4. Mélanger P (Fisher-Yates)
 *    5. Prendre les 6 premiers (ou tous si P < 6)
 *
 *  Contraintes :
 *    - Jamais de traversée entre la base comics et la base img
 *    - Jamais de traversée entre séries
 *    - Le folder admin-only est exclu pour un reader
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
 * une valeur donnée via un prédicat.
 *
 * @template T
 * @param {T[]} arr         - Liste complète des candidats
 * @param {(item: T) => boolean} exclude - Prédicat d'exclusion (le courant)
 * @param {number} [count=6]
 * @param {() => number} [random=Math.random]
 * @returns {T[]}
 */
function pickSuggestions(arr, exclude, count = 6, random = Math.random) {
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
 * V1.2 — Détermine la base d'un folder : 'comics' ou 'img'.
 * @param {string} folder
 * @returns {'comics'|'img'}
 */
function baseFolderOf(folder) {
  return folder === 'comics' || folder === 'comics_admin' ? 'comics' : 'img';
}

/**
 * Suggestion de haut niveau : à partir de la structure complète du store,
 * retourne jusqu'à `count` suggestions pour un comics donné.
 *
 * V1.2 :
 *   - `count` par défaut = 6
 *   - cross-dossier admin : pour un admin, le pool couvre le folder normal
 *     ET le folder admin de la même base
 *   - exclusion du courant par identité (folder, name) pour éviter les
 *     collisions entre 'comics' et 'comics_admin'
 *
 * @param {object} params
 * @param {object} params.series     - Structure complète { serieName: { adminOnly, comics: [], img: [] } }
 * @param {string} params.serieName  - Nom de la série (lowercase)
 * @param {'comics'|'comics_admin'|'img'|'img_admin'} params.folder - Dossier du comics courant
 * @param {string} params.currentName - Nom du comics courant (pour exclusion)
 * @param {'reader'|'admin'} [params.role='reader']
 * @param {number} [params.count=6]
 * @param {() => number} [params.random]
 * @returns {Array<{ name: string, folder: string, adminOnly: boolean, pageCount: number, cover: string|null, hasVideo: boolean }>}
 *
 * @throws {Error} si serieName inconnu ou folder invalide
 */
function suggestForComics({
  series,
  serieName,
  folder,
  currentName,
  role = 'reader',
  count = 6,
  random = Math.random,
}) {
  if (!series || typeof series !== 'object') {
    throw new Error('suggestForComics: series est requis');
  }

  const VALID_FOLDERS = new Set([
    'comics',
    'comics_admin',
    'img',
    'img_admin',
  ]);
  if (!VALID_FOLDERS.has(folder)) {
    throw new Error(`suggestForComics: folder invalide "${folder}"`);
  }

  const serie = series[serieName];
  if (!serie) {
    throw new Error(`suggestForComics: série inconnue "${serieName}"`);
  }

  const base = baseFolderOf(folder); // 'comics' ou 'img'
  const list = serie[base] || [];

  // V1.2 : filtre par rôle
  //   - reader : uniquement les comics non-admin
  //   - admin  : tous les comics de la base (normal + admin)
  const visible = list.filter((c) => {
    if (!c.adminOnly) return true;
    return role === 'admin';
  });

  // Exclusion du courant par identité (folder, name)
  const picks = pickSuggestions(
    visible,
    (c) => c.folder === folder && c.name === currentName,
    count,
    random
  );

  // Normalisation de la sortie
  return picks.map((c) => ({
    name: c.name,
    folder: c.folder,
    adminOnly: c.adminOnly === true,
    pageCount: c.pages.length,
    cover: c.pages.length > 0 ? c.pages[0].file : null,
    hasVideo: c.hasVideo === true,
  }));
}

module.exports = {
  shuffle,
  pickSuggestions,
  suggestForComics,
  baseFolderOf,
};