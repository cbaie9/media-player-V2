'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { Store } = require('../../src/store');

let ROOT;
let CACHE;
let WARN;

/**
 * Arborescence de test :
 *
 *   onepiece/
 *     comics/       c_a (2 pages), c_b (1 page)
 *     comics_admin/ c_admin (1 page)
 *     img/          cover (1 page)
 *     img_admin/    secret (1 page)
 *   naruto/         (admin-only)
 *     comics_admin/ chap01 (1 page)
 *
 * Note : une série sans aucun fichier n'est PAS enregistrée par
 * le scanner (pas de contenu → pas de série).
 */
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-store-'));
  ROOT = path.join(dir, 'root');

  const w = (rel, content = 'x') => {
    const abs = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  w('onepiece/comics/c_a-0001.png');
  w('onepiece/comics/c_a-0002.png');
  w('onepiece/comics/c_b-0001.png');
  w('onepiece/comics_admin/c_admin-0001.png');
  w('onepiece/img/cover-0001.png');
  w('onepiece/img_admin/secret-0001.png');

  w('naruto/comics_admin/chap01-0001.png');

  CACHE = path.join(dir, 'cache', 'scan.json');
  WARN = path.join(dir, 'logs', 'scan-warnings.log');
});

function newStore() {
  return new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
}

// ---------------------------------------------------------------------------
// init / rescan / loadFromCache
// ---------------------------------------------------------------------------

test('init() scanne si cache absent', () => {
  const store = newStore();
  const res = store.init();
  assert.equal(res.source, 'scan');
  assert.equal(res.seriesCount, 2); // onepiece, naruto
  assert.ok(fs.existsSync(CACHE));
});

test('init() charge depuis le cache si présent', () => {
  const s1 = newStore();
  s1.init();

  const s2 = newStore();
  const res = s2.init();
  assert.equal(res.source, 'cache');
  assert.equal(s2.listSeries('admin').length, 2);
});

test('loadFromCache refuse un cache dont rootDir diffère', () => {
  const s1 = newStore();
  s1.init();

  const other = new Store({
    rootDir: '/tmp/autre',
    cacheFile: CACHE,
    warningsFile: WARN,
  });
  assert.equal(other.loadFromCache(), false);
});

// ---------------------------------------------------------------------------
// listSeries — V1.2 filtré par rôle
// ---------------------------------------------------------------------------

test('listSeries(reader) masque les séries admin-only', () => {
  const store = newStore();
  store.init();

  const list = store.listSeries('reader');
  const names = list.map((s) => s.name).sort();
  assert.deepEqual(names, ['onepiece']);
});

test('listSeries(admin) voit toutes les séries', () => {
  const store = newStore();
  store.init();

  const list = store.listSeries('admin');
  const names = list.map((s) => s.name).sort();
  assert.deepEqual(names, ['naruto', 'onepiece']);
});

test('listSeries(reader) ne compte que les comics visibles', () => {
  const store = newStore();
  store.init();

  const onepiece = store
    .listSeries('reader')
    .find((s) => s.name === 'onepiece');
  assert.equal(onepiece.comicsCount, 2); // c_a + c_b (c_admin exclu)
  assert.equal(onepiece.imgCount, 1); // cover (secret exclu)
});

test('listSeries(admin) compte TOUS les comics', () => {
  const store = newStore();
  store.init();

  const onepiece = store
    .listSeries('admin')
    .find((s) => s.name === 'onepiece');
  assert.equal(onepiece.comicsCount, 3); // c_a + c_b + c_admin
  assert.equal(onepiece.imgCount, 2); // cover + secret
});

test('listSeries expose adminOnly sur chaque série', () => {
  const store = newStore();
  store.init();

  const list = store.listSeries('admin');
  assert.equal(list.find((s) => s.name === 'naruto').adminOnly, true);
  assert.equal(list.find((s) => s.name === 'onepiece').adminOnly, false);
});

// ---------------------------------------------------------------------------
// getSerie — V1.2 role-aware
// ---------------------------------------------------------------------------

test('getSerie(reader) exclut les comics admin-only', () => {
  const store = newStore();
  store.init();

  const s = store.getSerie('onepiece', 'reader');
  const names = s.comics.map((c) => c.name).sort();
  assert.deepEqual(names, ['c_a', 'c_b']);
  assert.equal(s.img.length, 1);
  assert.equal(s.img[0].name, 'cover');
});

test('getSerie(admin) inclut les comics admin-only', () => {
  const store = newStore();
  store.init();

  const s = store.getSerie('onepiece', 'admin');
  const names = s.comics.map((c) => c.name).sort();
  assert.deepEqual(names, ['c_a', 'c_admin', 'c_b']);
  assert.equal(s.img.length, 2);
});

test('getSerie(reader) sur série admin-only → null', () => {
  const store = newStore();
  store.init();

  assert.equal(store.getSerie('naruto', 'reader'), null);
});

test('getSerie(admin) sur série admin-only → OK', () => {
  const store = newStore();
  store.init();

  const s = store.getSerie('naruto', 'admin');
  assert.ok(s);
  assert.equal(s.adminOnly, true);
  assert.equal(s.comics.length, 1);
  assert.equal(s.comics[0].name, 'chap01');
});

test('getSerie expose folder + adminOnly sur chaque comics', () => {
  const store = newStore();
  store.init();

  const s = store.getSerie('onepiece', 'admin');
  const normal = s.comics.find((c) => c.name === 'c_a');
  const admin = s.comics.find((c) => c.name === 'c_admin');
  assert.equal(normal.folder, 'comics');
  assert.equal(normal.adminOnly, false);
  assert.equal(admin.folder, 'comics_admin');
  assert.equal(admin.adminOnly, true);
});

// ---------------------------------------------------------------------------
// getComics — V1.2 role-aware + defense in depth
// ---------------------------------------------------------------------------

test('getComics(reader, folder=comics) → OK', () => {
  const store = newStore();
  store.init();

  const c = store.getComics('onepiece', 'comics', 'c_a', 'reader');
  assert.ok(c);
  assert.equal(c.folder, 'comics');
  assert.equal(c.adminOnly, false);
  assert.equal(c.pages.length, 2);
});

test('getComics(reader, folder=comics_admin) → null (404)', () => {
  const store = newStore();
  store.init();

  const c = store.getComics('onepiece', 'comics_admin', 'c_admin', 'reader');
  assert.equal(c, null);
});

test('getComics(admin, folder=comics_admin) → OK', () => {
  const store = newStore();
  store.init();

  const c = store.getComics('onepiece', 'comics_admin', 'c_admin', 'admin');
  assert.ok(c);
  assert.equal(c.adminOnly, true);
});

test('getComics : folder et name identifient le comics (2 entrées)', () => {
  const store = newStore();
  store.init();

  // onepiece a comics/c_a ET comics_admin/c_admin : pas de collision
  const normal = store.getComics('onepiece', 'comics', 'c_a', 'admin');
  const admin = store.getComics('onepiece', 'comics_admin', 'c_admin', 'admin');
  assert.ok(normal);
  assert.ok(admin);
  assert.notEqual(normal.folder, admin.folder);
});

test('getComics(reader, folder=img_admin) → null', () => {
  const store = newStore();
  store.init();

  const c = store.getComics('onepiece', 'img_admin', 'secret', 'reader');
  assert.equal(c, null);
});

test('getComics(admin, folder=img_admin) → OK', () => {
  const store = newStore();
  store.init();

  const c = store.getComics('onepiece', 'img_admin', 'secret', 'admin');
  assert.ok(c);
  assert.equal(c.folder, 'img_admin');
});

test('getComics : folder inconnu → null', () => {
  const store = newStore();
  store.init();

  assert.equal(store.getComics('onepiece', 'video', 'c_a', 'admin'), null);
});

// ---------------------------------------------------------------------------
// getComicsListForRole — V1.2
// ---------------------------------------------------------------------------

test('getComicsListForRole(reader, comics) exclut admin', () => {
  const store = newStore();
  store.init();

  const list = store.getComicsListForRole('onepiece', 'comics', 'reader');
  assert.equal(list.length, 2);
  assert.ok(list.every((c) => !c.adminOnly));
});

test('getComicsListForRole(admin, comics) inclut admin', () => {
  const store = newStore();
  store.init();

  const list = store.getComicsListForRole('onepiece', 'comics', 'admin');
  assert.equal(list.length, 3);
  assert.ok(list.some((c) => c.adminOnly));
});

test('getComicsListForRole(reader, img) exclut img_admin', () => {
  const store = newStore();
  store.init();

  const list = store.getComicsListForRole('onepiece', 'img', 'reader');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'cover');
});

// ---------------------------------------------------------------------------
// rescan
// ---------------------------------------------------------------------------

test('rescan écrase le cache et met à jour la structure', () => {
  const store = newStore();
  store.init();

  // Ajoute un comics normal à naruto → naruto n'est plus admin-only
  fs.mkdirSync(path.join(ROOT, 'naruto', 'comics'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'naruto', 'comics', 'new-0001.png'),
    'x'
  );
  store.rescan();

  const s = store.getSerie('naruto', 'reader');
  assert.ok(s);
  assert.equal(s.adminOnly, false);
});

test('ROOT_DIR cassé → error root_dir_unavailable, séries vides', () => {
  const store = new Store({
    rootDir: '/nonexistent/xyz',
    cacheFile: CACHE,
    warningsFile: WARN,
  });
  const res = store.rescan();
  assert.equal(res.error, 'root_dir_unavailable');
  assert.deepEqual(store.listSeries('admin'), []);
});