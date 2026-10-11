'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

const { Store } = require('../../src/store');
const { buildApiRouter } = require('../../src/routes/api');

let app;
let ROOT;
let CACHE;
let WARN;

/**
 * V1.2 — Arborescence de test :
 *
 *   onepiece/
 *     comics/       c_a (2 pages), c_b (1 page), c_c (1 page)
 *     comics_admin/ admin_x (1 page), admin_y (1 page)
 *     img/          cover_a (1 page)
 *     img_admin/    cover_secret (1 page)
 *   naruto/         (admin-only)
 *     comics_admin/ chap01 (1 page)
 */
function makeApp({ user = { username: 'reader', role: 'reader' } } = {}) {
  const store = new Store({
    rootDir: ROOT,
    cacheFile: CACHE,
    warningsFile: WARN,
  });
  store.rescan();

  const a = express();
  a.use(express.json());
  a.use(
    session({
      secret: 'test_secret_'.repeat(8),
      resave: false,
      saveUninitialized: false,
      name: 'connect.sid',
    })
  );

  // Middleware de session simulée pour les tests
  a.use((req, res, next) => {
    if (user) req.session.user = user;
    next();
  });

  a.use('/api', buildApiRouter({ store }));
  return a;
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-api-'));
  ROOT = path.join(dir, 'root');

  const w = (rel) => {
    const abs = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  };

  // onepiece
  w('onepiece/comics/c_a-0001.png');
  w('onepiece/comics/c_a-0002.png');
  w('onepiece/comics/c_b-0001.png');
  w('onepiece/comics/c_c-0001.png');
  w('onepiece/comics_admin/admin_x-0001.png');
  w('onepiece/comics_admin/admin_y-0001.png');
  w('onepiece/img/cover_a-0001.png');
  w('onepiece/img_admin/cover_secret-0001.png');

  // naruto — admin-only
  w('naruto/comics_admin/chap01-0001.png');

  CACHE = path.join(dir, 'cache', 'scan.json');
  WARN = path.join(dir, 'logs', 'scan-warnings.log');
});

// ---------------------------------------------------------------------------
// GET /api/series
// ---------------------------------------------------------------------------

test('GET /api/series (reader) → 2 séries (naruto exclue)', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series');
  assert.equal(res.status, 200);
  const names = res.body.series.map((s) => s.name).sort();
  assert.deepEqual(names, ['onepiece']);
});

test('GET /api/series (admin) → 2 séries (naruto visible)', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get('/api/series');
  assert.equal(res.status, 200);
  const names = res.body.series.map((s) => s.name).sort();
  assert.deepEqual(names, ['naruto', 'onepiece']);
});

test('GET /api/series (admin) marque naruto adminOnly', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get('/api/series');
  const naruto = res.body.series.find((s) => s.name === 'naruto');
  assert.equal(naruto.adminOnly, true);
});

test('GET /api/series (reader) compte uniquement les comics visibles', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series');
  const onepiece = res.body.series.find((s) => s.name === 'onepiece');
  assert.equal(onepiece.comicsCount, 3); // c_a, c_b, c_c (admin_x/y exclus)
  assert.equal(onepiece.imgCount, 1);    // cover_a (cover_secret exclu)
});

test('GET /api/series (admin) compte TOUS les comics', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get('/api/series');
  const onepiece = res.body.series.find((s) => s.name === 'onepiece');
  assert.equal(onepiece.comicsCount, 5); // c_a, c_b, c_c, admin_x, admin_y
  assert.equal(onepiece.imgCount, 2);    // cover_a + cover_secret
});

test('GET /api/series sans session → 401', async () => {
  app = makeApp({ user: null });
  const res = await request(app).get('/api/series');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'unauthorized');
});

// ---------------------------------------------------------------------------
// GET /api/series/:serie
// ---------------------------------------------------------------------------

test('GET /api/series/onepiece (reader) → comics sans les admin', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/onepiece');
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'onepiece');
  assert.equal(res.body.adminOnly, false);
  const names = res.body.comics.map((c) => c.name).sort();
  assert.deepEqual(names, ['c_a', 'c_b', 'c_c']);
});

test('GET /api/series/onepiece (admin) → tous les comics', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get('/api/series/onepiece');
  assert.equal(res.status, 200);
  const names = res.body.comics.map((c) => c.name).sort();
  assert.deepEqual(names, ['admin_x', 'admin_y', 'c_a', 'c_b', 'c_c']);
});

test('GET /api/series/onepiece expose folder + adminOnly sur chaque comics', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get('/api/series/onepiece');
  const cA = res.body.comics.find((c) => c.name === 'c_a');
  const adminX = res.body.comics.find((c) => c.name === 'admin_x');
  assert.equal(cA.folder, 'comics');
  assert.equal(cA.adminOnly, false);
  assert.equal(adminX.folder, 'comics_admin');
  assert.equal(adminX.adminOnly, true);
});

test('GET /api/series/naruto (reader) → 404 (admin-only)', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/naruto');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'serie_not_found');
});

test('GET /api/series/naruto (admin) → 200', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get('/api/series/naruto');
  assert.equal(res.status, 200);
  assert.equal(res.body.adminOnly, true);
  assert.equal(res.body.comics.length, 1);
});

test('GET /api/series/inexistante → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/inexistante');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'serie_not_found');
});

test('GET /api/series/INVALID! → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/INVALID!');
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// GET /api/series/:serie/:folder/:name
// ---------------------------------------------------------------------------

test('GET comics normal (reader) → 200', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/onepiece/comics/c_a');
  assert.equal(res.status, 200);
  assert.equal(res.body.pages.length, 2);
  assert.equal(res.body.folder, 'comics');
  assert.equal(res.body.adminOnly, false);
});

test('GET comics admin en reader → 404', async () => {
  app = makeApp();
  const res = await request(app).get(
    '/api/series/onepiece/comics_admin/admin_x'
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'comics_not_found');
});

test('GET comics admin en admin → 200', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get(
    '/api/series/onepiece/comics_admin/admin_x'
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.folder, 'comics_admin');
  assert.equal(res.body.adminOnly, true);
});

test('GET img admin en reader → 404', async () => {
  app = makeApp();
  const res = await request(app).get(
    '/api/series/onepiece/img_admin/cover_secret'
  );
  assert.equal(res.status, 404);
});

test('GET img admin en admin → 200', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get(
    '/api/series/onepiece/img_admin/cover_secret'
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.folder, 'img_admin');
});

test('GET comics : folder invalide → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/onepiece/video/c_a');
  assert.equal(res.status, 404);
});

test('GET comics inconnu → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/onepiece/comics/zzz');
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// GET /api/series/:serie/:folder/:name/suggestions
// ---------------------------------------------------------------------------

test('suggestions (reader) → uniquement comics normal, max 6', async () => {
  app = makeApp();
  const res = await request(app).get(
    '/api/series/onepiece/comics/c_a/suggestions'
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.suggestions));
  // c_b + c_c = 2 candidats
  assert.equal(res.body.suggestions.length, 2);
  assert.ok(res.body.suggestions.every((s) => s.adminOnly === false));
  assert.ok(!res.body.suggestions.some((s) => s.name === 'c_a'));
});

test('suggestions (admin) → cross comics + comics_admin', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get(
    '/api/series/onepiece/comics/c_a/suggestions'
  );
  assert.equal(res.status, 200);
  // pool = 5 comics - c_a = 4 candidats
  assert.equal(res.body.suggestions.length, 4);
  assert.ok(res.body.suggestions.some((s) => s.adminOnly === true));
  assert.ok(res.body.suggestions.some((s) => s.adminOnly === false));
});

test('suggestions : chaque item expose folder + adminOnly', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get(
    '/api/series/onepiece/comics/c_a/suggestions'
  );
  for (const s of res.body.suggestions) {
    assert.ok('folder' in s);
    assert.ok('adminOnly' in s);
    assert.ok('hasVideo' in s);
    assert.equal(typeof s.pageCount, 'number');
    assert.ok(s.cover === null || typeof s.cover === 'string');
  }
});

test('suggestions : ne traverse jamais comics ↔ img', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get(
    '/api/series/onepiece/comics/c_a/suggestions'
  );
  assert.ok(!res.body.suggestions.some((s) => s.name.startsWith('cover_')));
});

test('suggestions (reader) sur comics_admin → 404', async () => {
  app = makeApp();
  const res = await request(app).get(
    '/api/series/onepiece/comics_admin/admin_x/suggestions'
  );
  assert.equal(res.status, 404);
});

test('suggestions sur comics inconnu → 404', async () => {
  app = makeApp();
  const res = await request(app).get(
    '/api/series/onepiece/comics/zzz/suggestions'
  );
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// POST /api/rescan
// ---------------------------------------------------------------------------

test('POST /api/rescan en reader → 403', async () => {
  app = makeApp({ user: { username: 'reader', role: 'reader' } });
  const res = await request(app).post('/api/rescan');
  assert.equal(res.status, 403);
});

test('POST /api/rescan en admin → 200', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).post('/api/rescan');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.seriesCount, 2);
});