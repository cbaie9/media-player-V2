'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  shuffle,
  pickSuggestions,
  suggestForComics,
  baseFolderOf,
} = require('../../src/suggest');

// ---------------------------------------------------------------------------
// shuffle
// ---------------------------------------------------------------------------

test('shuffle préserve les éléments', () => {
  const arr = [1, 2, 3, 4, 5];
  const copy = [...arr];
  shuffle(arr, () => 0.5);
  assert.deepEqual([...arr].sort(), [...copy].sort());
});

test('shuffle avec random injecté est déterministe', () => {
  const a = [1, 2, 3, 4, 5];
  const b = [1, 2, 3, 4, 5];
  const seq = [0.1, 0.5, 0.9, 0.3];
  let i = 0;
  const rnd = () => seq[i++ % seq.length];
  shuffle(a, rnd);
  i = 0;
  shuffle(b, rnd);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// pickSuggestions
// ---------------------------------------------------------------------------

test('pickSuggestions retourne count max (défaut 6)', () => {
  const arr = Array.from({ length: 10 }, (_, i) => ({ name: `c${i}` }));
  const r = pickSuggestions(arr, () => false);
  assert.equal(r.length, 6);
});

test('pickSuggestions exclut le courant', () => {
  const arr = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
  const r = pickSuggestions(arr, (x) => x.name === 'a', 6, () => 0.5);
  assert.equal(r.length, 3);
  assert.ok(!r.some((x) => x.name === 'a'));
});

test('pickSuggestions retourne < count si peu de candidats', () => {
  const arr = [{ name: 'a' }, { name: 'b' }];
  const r = pickSuggestions(arr, (x) => x.name === 'a');
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'b');
});

test('pickSuggestions retourne [] si seul le courant', () => {
  const arr = [{ name: 'a' }];
  assert.deepEqual(pickSuggestions(arr, (x) => x.name === 'a'), []);
});

test('pickSuggestions retourne [] si tableau vide', () => {
  assert.deepEqual(pickSuggestions([], () => false), []);
  assert.deepEqual(pickSuggestions(null, () => false), []);
});

// ---------------------------------------------------------------------------
// baseFolderOf (V1.2)
// ---------------------------------------------------------------------------

test('baseFolderOf', () => {
  assert.equal(baseFolderOf('comics'), 'comics');
  assert.equal(baseFolderOf('comics_admin'), 'comics');
  assert.equal(baseFolderOf('img'), 'img');
  assert.equal(baseFolderOf('img_admin'), 'img');
});

// ---------------------------------------------------------------------------
// suggestForComics — V1.2
// ---------------------------------------------------------------------------

/**
 * Fixture V1.2 : onepiece contient comics normal (3 comics) + comics_admin
 * (2 comics), plus img (1) + img_admin (1).
 */
function makeSeries() {
  const C = (name, folder, adminOnly, pages) => ({
    name,
    folder,
    adminOnly,
    hasVideo: false,
    pages: pages.map((n, i) => ({
      num: i + 1,
      file: `${name}-000${i + 1}.png`,
      ext: 'png',
      type: 'image',
      hasVideo: false,
    })),
  });

  return {
    onepiece: {
      adminOnly: false,
      comics: [
        C('comics_a', 'comics', false, [1, 2, 3]),
        C('comics_b', 'comics', false, [1]),
        C('comics_c', 'comics', false, [1]),
        C('admin_x', 'comics_admin', true, [1, 2]),
        C('admin_y', 'comics_admin', true, [1]),
      ],
      img: [
        C('cover_a', 'img', false, [1]),
        C('secret_x', 'img_admin', true, [1]),
      ],
    },
    naruto: {
      adminOnly: true,
      comics: [C('chap01', 'comics_admin', true, [1])],
      img: [],
    },
  };
}

test('V1.2 : reader ne reçoit QUE des suggestions non-admin', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
    role: 'reader',
  });
  assert.equal(r.length, 2); // comics_b + comics_c
  assert.ok(r.every((x) => x.adminOnly === false));
});

test('V1.2 : admin reçoit TOUTES les suggestions (normal + admin)', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
    role: 'admin',
  });
  // pool = comics_a(3) - comics_a + admin_x + admin_y = 4 candidats
  assert.equal(r.length, 4);
  assert.ok(r.some((x) => x.adminOnly === true));
  assert.ok(r.some((x) => x.adminOnly === false));
});

test('V1.2 : count par défaut = 6', () => {
  const series = {
    s: {
      adminOnly: false,
      comics: Array.from({ length: 10 }, (_, i) => ({
        name: `c${i}`,
        folder: 'comics',
        adminOnly: false,
        hasVideo: false,
        pages: [{ num: 1, file: `c${i}-0001.png`, ext: 'png', type: 'image' }],
      })),
      img: [],
    },
  };
  const r = suggestForComics({
    series,
    serieName: 's',
    folder: 'comics',
    currentName: 'c0',
    role: 'reader',
  });
  assert.equal(r.length, 6);
});

test('V1.2 : exclusion du courant par identité (folder, name)', () => {
  // Si comics/c_a et comics_admin/c_a existent, seul le vrai courant est exclu
  const series = {
    s: {
      adminOnly: false,
      comics: [
        {
          name: 'a',
          folder: 'comics',
          adminOnly: false,
          pages: [{ num: 1, file: 'a-0001.png' }],
        },
        {
          name: 'a',
          folder: 'comics_admin',
          adminOnly: true,
          pages: [{ num: 1, file: 'a-0001.png' }],
        },
        {
          name: 'b',
          folder: 'comics',
          adminOnly: false,
          pages: [{ num: 1, file: 'b-0001.png' }],
        },
      ],
      img: [],
    },
  };

  // Courant = comics/a. En admin, on doit recevoir comics_admin/a ET comics/b.
  const r = suggestForComics({
    series,
    serieName: 's',
    folder: 'comics',
    currentName: 'a',
    role: 'admin',
  });
  assert.equal(r.length, 2);
  const folders = r.map((x) => x.folder).sort();
  assert.deepEqual(folders, ['comics', 'comics_admin']);
});

test('V1.2 : ne traverse JAMAIS comics ↔ img', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
    role: 'admin',
  });
  assert.ok(!r.some((x) => x.name.startsWith('cover_')));
  assert.ok(!r.some((x) => x.name.startsWith('secret_')));
});

test('V1.2 : ne traverse JAMAIS entre séries', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'naruto',
    folder: 'comics_admin',
    currentName: 'chap01',
    role: 'admin',
  });
  assert.deepEqual(r, []);
});

/**
 * V1.2 — Comportement du module seul.
 *
 * Note importante : `suggestForComics` ne connaît PAS le folder du comics
 * courant pour filtrer le POOL. Il filtre uniquement les items du pool
 * selon leur propre `adminOnly` et le rôle.
 *
 * Conséquence : si un reader appelle `suggestForComics` avec
 * `folder='comics_admin'` (ce qui n'arrive pas en prod car `api.js`
 * rejette avant), le pool reste composé des comics NON-admin de la même
 * base — c'est-à-dire les comics normaux. C'est le comportement attendu
 * du module.
 *
 * Le filtrage en amont (404 si folder admin + role reader) est fait par
 * `src/routes/api.js` + `src/store.js` (défense en profondeur).
 */
test('V1.2 : suggestForComics ne filtre PAS le pool par folder courant', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics_admin', // simulé : normalement rejeté en amont
    currentName: 'admin_x',
    role: 'reader',
  });

  // Le pool reste les comics normaux (non-admin) : comics_a, comics_b, comics_c.
  // L'exclusion porte sur (folder='comics_admin', name='admin_x') — qui
  // n'est de toute façon pas dans le pool reader.
  // → On reçoit les 3 comics normaux.
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => x.adminOnly === false));
  assert.ok(r.every((x) => x.folder === 'comics'));
  assert.ok(!r.some((x) => x.name === 'admin_x'));
});

test('V1.2 : chaque suggestion expose folder + adminOnly + hasVideo', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
    role: 'admin',
  });
  for (const s of r) {
    assert.ok('folder' in s);
    assert.ok('adminOnly' in s);
    assert.ok('hasVideo' in s);
    assert.equal(typeof s.pageCount, 'number');
  }
});

test('suggestForComics inclut cover = premier fichier du comics', () => {
  const series = {
    s: {
      adminOnly: false,
      comics: [
        {
          name: 'a',
          folder: 'comics',
          adminOnly: false,
          pages: [{ num: 1, file: 'a-0001.png' }],
        },
        {
          name: 'b',
          folder: 'comics',
          adminOnly: false,
          pages: [{ num: 1, file: 'b-0001.png' }],
        },
        {
          name: 'c',
          folder: 'comics',
          adminOnly: false,
          pages: [{ num: 1, file: 'c-0001.mp4' }],
        },
      ],
      img: [],
    },
  };

  const r = suggestForComics({
    series,
    serieName: 's',
    folder: 'comics',
    currentName: 'a',
    role: 'reader',
    random: () => 0,
  });

  assert.equal(r.length, 2);
  const byName = Object.fromEntries(r.map((x) => [x.name, x]));
  if (byName.b) assert.equal(byName.b.cover, 'b-0001.png');
  if (byName.c) assert.equal(byName.c.cover, 'c-0001.mp4');
});

test('suggestForComics cover = null si pages vides', () => {
  const series = {
    s: {
      adminOnly: false,
      comics: [
        {
          name: 'a',
          folder: 'comics',
          adminOnly: false,
          pages: [{ num: 1, file: 'a-0001.png' }],
        },
        { name: 'empty', folder: 'comics', adminOnly: false, pages: [] },
      ],
      img: [],
    },
  };
  const r = suggestForComics({
    series,
    serieName: 's',
    folder: 'comics',
    currentName: 'a',
    role: 'reader',
    random: () => 0,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'empty');
  assert.equal(r[0].cover, null);
});

test('suggestForComics throw si série inconnue', () => {
  assert.throws(
    () =>
      suggestForComics({
        series: makeSeries(),
        serieName: 'inexistante',
        folder: 'comics',
        currentName: 'x',
        role: 'reader',
      }),
    /série inconnue/
  );
});

test('suggestForComics throw si folder invalide', () => {
  assert.throws(
    () =>
      suggestForComics({
        series: makeSeries(),
        serieName: 'onepiece',
        folder: 'video',
        currentName: 'x',
        role: 'reader',
      }),
    /folder invalide/
  );
});

test('suggestForComics accepte les 4 folders', () => {
  const series = makeSeries();
  for (const f of ['comics', 'comics_admin', 'img', 'img_admin']) {
    assert.doesNotThrow(() =>
      suggestForComics({
        series,
        serieName: 'onepiece',
        folder: f,
        currentName: 'inexistant',
        role: 'admin',
      })
    );
  }
});