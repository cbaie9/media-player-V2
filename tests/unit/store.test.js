'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { makeFixtures } = require('../../scripts/make-fixtures');
const { Store } = require('../../src/store');

let ROOT;
let CACHE;
let WARN;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-store-'));
  ROOT = path.join(dir, 'root');
  fs.mkdirSync(ROOT, { recursive: true });
  // On génère les fixtures dans ROOT
  const orig = process.cwd;
  // astuce : makeFixtures écrit toujours dans FIXTURES_ROOT figé ; on
  // recopie manuellement une arborescence minimale pour le store.
  fs.mkdirSync(path.join(ROOT, 'onepiece', 'comics'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'onepiece', 'img'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'onepiece', 'comics', 'c_a-0001.png'), 'x');
  fs.writeFileSync(path.join(ROOT, 'onepiece', 'comics', 'c_a-0002.png'), 'x');
  fs.writeFileSync(path.join(ROOT, 'onepiece', 'comics', 'c_b-0001.png'), 'x');
  fs.writeFileSync(path.join(ROOT, 'onepiece', 'img', 'cover-0001.png'), 'x');

  fs.mkdirSync(path.join(ROOT, 'naruto', 'comics'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'naruto', 'comics', 'chap01-0001.png'), 'x');

  CACHE = path.join(dir, 'cache', 'scan.json');
  WARN = path.join(dir, 'logs', 'scan-warnings.log');
});

test('init() scanne si cache absent', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  const res = store.init();
  assert.equal(res.source, 'scan');
  assert.equal(res.seriesCount, 2);
  assert.ok(fs.existsSync(CACHE));
});

test('init() charge depuis le cache si présent', () => {
  const s1 = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  s1.init();

  const s2 = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  const res = s2.init();
  assert.equal(res.source, 'cache');
  assert.equal(s2.listSeries().length, 2);
});

test('listSeries retourne comicsCount et imgCount', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();
  const list = store.listSeries();

  assert.equal(list.length, 2);
  const onepiece = list.find((s) => s.name === 'onepiece');
  assert.equal(onepiece.comicsCount, 2);
  assert.equal(onepiece.imgCount, 1);

  const naruto = list.find((s) => s.name === 'naruto');
  assert.equal(naruto.comicsCount, 1);
  assert.equal(naruto.imgCount, 0);
});

test('getSerie retourne les comics avec cover', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();
  const s = store.getSerie('onepiece');

  assert.equal(s.name, 'onepiece');
  assert.equal(s.comics.length, 2);
  const ca = s.comics.find((c) => c.name === 'c_a');
  assert.equal(ca.pageCount, 2);
  assert.equal(ca.cover, 'c_a-0001.png');
});

test('getSerie retourne null si inconnue', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();
  assert.equal(store.getSerie('inexistante'), null);
});

test('getComics retourne les pages d\'un comics', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();
  const c = store.getComics('onepiece', 'comics', 'c_a');

  assert.equal(c.serie, 'onepiece');
  assert.equal(c.folder, 'comics');
  assert.equal(c.pages.length, 2);
  assert.equal(c.pages[0].num, 1);
  assert.equal(c.pages[1].num, 2);
});

test('getComics retourne null si folder invalide', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();
  assert.equal(store.getComics('onepiece', 'video', 'c_a'), null);
});

test('getComics retourne null si comics inconnu', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();
  assert.equal(store.getComics('onepiece', 'comics', 'zzz'), null);
});

test('rescan écrase le cache et met à jour la structure', () => {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();

  // Ajoute un comics et rescan
  fs.writeFileSync(path.join(ROOT, 'naruto', 'comics', 'chap02-0001.png'), 'x');
  const res = store.rescan();

  assert.equal(res.seriesCount, 2);
  assert.equal(store.getSerie('naruto').comics.length, 2);
});

test('ROOT_DIR cassé → error root_dir_unavailable, séries vides', () => {
  const store = new Store({
    rootDir: '/nonexistent/xyz',
    cacheFile: CACHE,
    warningsFile: WARN,
  });
  const res = store.rescan();
  assert.equal(res.error, 'root_dir_unavailable');
  assert.deepEqual(store.listSeries(), []);
});

test('loadFromCache refuse un cache dont rootDir diffère', () => {
  const s1 = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  s1.init();

  const other = new Store({
    rootDir: '/tmp/autre',
    cacheFile: CACHE,
    warningsFile: WARN,
  });
  const ok = other.loadFromCache();
  assert.equal(ok, false);
});