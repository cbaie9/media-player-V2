'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const filterLib = require('../../public/js/filter.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function items() {
  return [
    { name: 'comics_a', pageCount: 12, hasVideo: true },
    { name: 'comics_b', pageCount: 5, hasVideo: false },
    { name: 'comics_c', pageCount: 8, hasVideo: false },
    { name: 'cover_a', pageCount: 1, hasVideo: false },
    { name: 'long_name', pageCount: 50, hasVideo: true },
  ];
}

// ---------------------------------------------------------------------------
// normalizeBounds (C4, C5, C8)
// ---------------------------------------------------------------------------

test('normalizeBounds : défauts → min=0, max=null (∞)', () => {
  assert.deepEqual(filterLib.normalizeBounds(undefined, undefined), {
    min: 0,
    max: null,
  });
  assert.deepEqual(filterLib.normalizeBounds('', ''), { min: 0, max: null });
});

test('normalizeBounds : X minimum forcé à 0 (C5)', () => {
  assert.deepEqual(filterLib.normalizeBounds(-5, 10), { min: 0, max: 10 });
});

test('normalizeBounds : X > Y → inversion silencieuse (C8)', () => {
  assert.deepEqual(filterLib.normalizeBounds(10, 3), { min: 3, max: 10 });
});

test('normalizeBounds : max seul → min=0', () => {
  assert.deepEqual(filterLib.normalizeBounds(undefined, 8), { min: 0, max: 8 });
});

test('normalizeBounds : NaN → défauts', () => {
  assert.deepEqual(filterLib.normalizeBounds('abc', 'xyz'), { min: 0, max: null });
});

// ---------------------------------------------------------------------------
// matchesQuery (A3, A8, A11)
// ---------------------------------------------------------------------------

test('matchesQuery : substring insensible à la casse', () => {
  assert.equal(filterLib.matchesQuery({ name: 'Comics_A' }, 'comics'), true);
  assert.equal(filterLib.matchesQuery({ name: 'Comics_A' }, 'COMICS'), true);
  assert.equal(filterLib.matchesQuery({ name: 'Comics_A' }, 'a'), true);
  assert.equal(filterLib.matchesQuery({ name: 'Comics_A' }, 'zzz'), false);
});

test('matchesQuery : requête vide → tout matche', () => {
  assert.equal(filterLib.matchesQuery({ name: 'x' }, ''), true);
  assert.equal(filterLib.matchesQuery({ name: 'x' }, null), true);
});

test('matchesQuery : ne matche PAS le numéro de page (A11)', () => {
  // Un comics nommé "comics_a" avec 12 pages : "12" ne doit PAS matcher.
  assert.equal(filterLib.matchesQuery({ name: 'comics_a', pageCount: 12 }, '12'), false);
});

// ---------------------------------------------------------------------------
// matchesRange (C1, C11)
// ---------------------------------------------------------------------------

test('matchesRange : intervalle inclusif', () => {
  assert.equal(filterLib.matchesRange({ pageCount: 5 }, 5, 5).ok, true);
  assert.equal(filterLib.matchesRange({ pageCount: 5 }, 0, 5).ok, true);
  assert.equal(filterLib.matchesRange({ pageCount: 6 }, 0, 5).ok, false);
  assert.equal(filterLib.matchesRange({ pageCount: 5 }, 6, null).ok, false);
});

test('matchesRange : pageCount = 0 → exclu + reason (C11)', () => {
  const r = filterLib.matchesRange({ pageCount: 0 }, 0, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'zero_page_count');
});

// ---------------------------------------------------------------------------
// apply — intégration
// ---------------------------------------------------------------------------

test('apply : tout passe avec les défauts', () => {
  const r = filterLib.apply(items(), {});
  assert.equal(r.length, 5);
});

test('apply : filtre [X,Y] inclusif', () => {
  const r = filterLib.apply(items(), { min: 5, max: 12 });
  assert.deepEqual(
    r.map((x) => x.name).sort(),
    ['comics_a', 'comics_b', 'comics_c']
  );
});

test('apply : tri alphabétique (défaut)', () => {
  const r = filterLib.apply(items(), { sort: 'alpha' });
  assert.deepEqual(
    r.map((x) => x.name),
    ['comics_a', 'comics_b', 'comics_c', 'cover_a', 'long_name']
  );
});

test('apply : tri pages croissant', () => {
  const r = filterLib.apply(items(), { sort: 'pages_asc' });
  assert.deepEqual(
    r.map((x) => x.pageCount),
    [1, 5, 8, 12, 50]
  );
});

test('apply : tri pages décroissant', () => {
  const r = filterLib.apply(items(), { sort: 'pages_desc' });
  assert.deepEqual(
    r.map((x) => x.pageCount),
    [50, 12, 8, 5, 1]
  );
});

test('apply : recherche + filtre [X,Y] en ET logique (A10, C10)', () => {
  const r = filterLib.apply(items(), {
    query: 'comics',
    min: 6,
    max: null,
  });
  assert.deepEqual(
    r.map((x) => x.name).sort(),
    ['comics_a', 'comics_c']
  );
});

test('apply : pageCount = 0 → console.error + exclu', () => {
  const errors = [];
  const r = filterLib.apply(
    [
      { name: 'a', pageCount: 0 },
      { name: 'b', pageCount: 5 },
    ],
    { onAnomaly: (msg) => errors.push(msg) }
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'b');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /a/);
});

test('apply : X > Y → inversion silencieuse', () => {
  const r = filterLib.apply(items(), { min: 12, max: 5 });
  assert.deepEqual(
    r.map((x) => x.pageCount).sort((a, b) => a - b),
    [5, 8, 12]
  );
});

test('apply : X minimum forcé à 0', () => {
  const r = filterLib.apply(items(), { min: -10, max: 3 });
  assert.deepEqual(r.map((x) => x.name), ['cover_a']);
});

test('apply : recherche insensible casse', () => {
  const r = filterLib.apply(items(), { query: 'COMICS_A' });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'comics_a');
});

test('apply : tableau vide → []', () => {
  assert.deepEqual(filterLib.apply([], {}), []);
  assert.deepEqual(filterLib.apply(null, {}), []);
});

test('apply : ne modifie pas le tableau d\'entrée', () => {
  const input = items();
  const snapshot = input.map((x) => x.name);
  filterLib.apply(input, { sort: 'pages_desc' });
  assert.deepEqual(input.map((x) => x.name), snapshot);
});

// ---------------------------------------------------------------------------
// URL (C7, E5)
// ---------------------------------------------------------------------------

test('parseFromSearch : query vide → défauts (E5)', () => {
  const p = filterLib.parseFromSearch('');
  assert.equal(p.min, 0);
  assert.equal(p.max, null);
  assert.equal(p.rawMax, '');
  assert.equal(p.sort, 'alpha');
});

test('parseFromSearch : lit min/max/sort', () => {
  const p = filterLib.parseFromSearch('?min=2&max=8&sort=pages_asc');
  assert.equal(p.min, 2);
  assert.equal(p.max, 8);
  assert.equal(p.sort, 'pages_asc');
});

test('parseFromSearch : sort inconnu → défaut', () => {
  const p = filterLib.parseFromSearch('?sort=random_thing');
  assert.equal(p.sort, 'alpha');
});

test('buildSearch : ne sérialise QUE les non-défauts', () => {
  assert.equal(filterLib.buildSearch({ min: 0, max: null, sort: 'alpha' }), '');
});

test('buildSearch : sérialise min/max/sort', () => {
  const qs = filterLib.buildSearch({ min: 2, max: 8, sort: 'pages_desc' });
  const sp = new URLSearchParams(qs);
  assert.equal(sp.get('min'), '2');
  assert.equal(sp.get('max'), '8');
  assert.equal(sp.get('sort'), 'pages_desc');
});

test('parse+build : round-trip stable', () => {
  const qs1 = 'min=3&max=7&sort=pages_asc';
  const parsed = filterLib.parseFromSearch(qs1);
  const qs2 = filterLib.buildSearch(parsed);
  assert.equal(qs2, qs1);
});