'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  shuffle,
  pickSuggestions,
  suggestForComics,
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

test('pickSuggestions retourne 3 max', () => {
  const arr = [1, 2, 3, 4, 5, 6];
  const r = pickSuggestions(arr, () => false, 3);
  assert.equal(r.length, 3);
});

test('pickSuggestions exclut le courant', () => {
  const arr = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
  const r = pickSuggestions(arr, (x) => x.name === 'a', 3, () => 0.5);
  assert.equal(r.length, 3);
  assert.ok(!r.some((x) => x.name === 'a'));
});

test('pickSuggestions retourne < 3 si moins de 3 autres', () => {
  const arr = [{ name: 'a' }, { name: 'b' }];
  const r = pickSuggestions(arr, (x) => x.name === 'a');
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'b');
});

test('pickSuggestions retourne [] si seul le courant', () => {
  const arr = [{ name: 'a' }];
  const r = pickSuggestions(arr, (x) => x.name === 'a');
  assert.deepEqual(r, []);
});

test('pickSuggestions retourne [] si tableau vide', () => {
  assert.deepEqual(pickSuggestions([], () => false), []);
  assert.deepEqual(pickSuggestions(null, () => false), []);
});

test('pickSuggestions ne retourne jamais de doublon', () => {
  const arr = Array.from({ length: 10 }, (_, i) => ({ name: `c${i}` }));
  for (let i = 0; i < 20; i++) {
    const r = pickSuggestions(arr, (x) => x.name === 'c0', 3);
    const names = r.map((x) => x.name);
    assert.equal(new Set(names).size, names.length);
  }
});

test('pickSuggestions distribution couvre tous les éléments', () => {
  const arr = Array.from({ length: 5 }, (_, i) => ({ name: `c${i}` }));
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const r = pickSuggestions(arr, (x) => x.name === 'c0', 3);
    for (const x of r) seen.add(x.name);
  }
  for (let i = 1; i <= 4; i++) {
    assert.ok(seen.has(`c${i}`), `c${i} jamais vu`);
  }
});

// ---------------------------------------------------------------------------
// suggestForComics
// ---------------------------------------------------------------------------

function makeSeries() {
  return {
    onepiece: {
      comics: [
        { name: 'comics_a', pages: [{ num: 1, file: 'comics_a-0001.png' }] },
        {
          name: 'comics_b',
          pages: [
            { num: 1, file: 'comics_b-0001.png' },
            { num: 2, file: 'comics_b-0002.png' },
          ],
        },
        {
          name: 'comics_c',
          pages: [
            { num: 1, file: 'comics_c-0001.png' },
            { num: 2, file: 'comics_c-0002.png' },
            { num: 3, file: 'comics_c-0003.png' },
          ],
        },
        { name: 'comics_d', pages: [{ num: 1, file: 'comics_d-0001.png' }] },
      ],
      img: [
        { name: 'cover_a', pages: [{ num: 1, file: 'cover_a-0001.png' }] },
        { name: 'cover_b', pages: [{ num: 1, file: 'cover_b-0001.png' }] },
      ],
    },
    naruto: {
      comics: [{ name: 'chap01', pages: [{ num: 1, file: 'chap01-0001.png' }] }],
      img: [],
    },
  };
}

test('suggestForComics retourne 3 suggestions max', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
  });
  assert.equal(r.length, 3);
  assert.ok(!r.some((x) => x.name === 'comics_a'));
});

test('suggestForComics ne traverse pas comics ↔ img', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
  });
  assert.ok(!r.some((x) => x.name.startsWith('cover_')));
});

test('suggestForComics ne traverse pas entre séries', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'naruto',
    folder: 'comics',
    currentName: 'chap01',
  });
  assert.deepEqual(r, []);
});

test('suggestForComics retourne < 3 si peu de candidats', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'img',
    currentName: 'cover_a',
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'cover_b');
});

test('suggestForComics exclut le courant', () => {
  for (let i = 0; i < 50; i++) {
    const r = suggestForComics({
      series: makeSeries(),
      serieName: 'onepiece',
      folder: 'comics',
      currentName: 'comics_a',
    });
    assert.ok(!r.some((x) => x.name === 'comics_a'));
  }
});

test('suggestForComics inclut pageCount', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
  });
  for (const x of r) {
    assert.equal(typeof x.pageCount, 'number');
    assert.ok(x.pageCount > 0);
  }
});

test('suggestForComics inclut cover', () => {
  const r = suggestForComics({
    series: makeSeries(),
    serieName: 'onepiece',
    folder: 'comics',
    currentName: 'comics_a',
  });
  for (const x of r) {
    assert.ok('cover' in x, `cover manquant pour ${x.name}`);
    assert.equal(typeof x.cover, 'string');
    assert.match(x.cover, /\.png$/);
  }
});

test('suggestForComics cover = premier fichier du comics', () => {
  const series = {
    s: {
      comics: [
        { name: 'a', pages: [{ num: 1, file: 'a-0001.png' }] },
        { name: 'b', pages: [{ num: 1, file: 'b-0001.png' }] },
        { name: 'c', pages: [{ num: 1, file: 'c-0001.mp4' }] },
      ],
      img: [],
    },
  };

  const r = suggestForComics({
    series,
    serieName: 's',
    folder: 'comics',
    currentName: 'a',
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
      comics: [
        { name: 'a', pages: [{ num: 1, file: 'a-0001.png' }] },
        { name: 'empty', pages: [] },
      ],
      img: [],
    },
  };
  const r = suggestForComics({
    series,
    serieName: 's',
    folder: 'comics',
    currentName: 'a',
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
      }),
    /folder invalide/
  );
});