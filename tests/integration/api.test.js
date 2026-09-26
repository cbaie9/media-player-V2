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

function makeApp({ user = { username: 'reader', role: 'reader' } } = {}) {
  const store = new Store({ rootDir: ROOT, cacheFile: CACHE, warningsFile: WARN });
  store.init();

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
  fs.mkdirSync(path.join(ROOT, 'onepiece', 'comics'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'onepiece', 'comics', 'c_a-0001.png'), 'x');
  fs.writeFileSync(path.join(ROOT, 'onepiece', 'comics', 'c_a-0002.png'), 'x');
  fs.writeFileSync(path.join(ROOT, 'onepiece', 'comics', 'c_b-0001.png'), 'x');
  CACHE = path.join(dir, 'cache', 'scan.json');
  WARN = path.join(dir, 'logs', 'scan-warnings.log');
});

test('GET /api/series avec session → 200', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series');
  assert.equal(res.status, 200);
  assert.equal(res.body.series.length, 1);
  assert.equal(res.body.series[0].name, 'onepiece');
});

test('GET /api/series sans session → 401', async () => {
  app = makeApp({ user: null });
  const res = await request(app).get('/api/series');
  assert.equal(res.status, 401);
});

test('GET /api/series/:serie → 200', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/onepiece');
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'onepiece');
  assert.equal(res.body.comics.length, 2);
});

test('GET /api/series/inexistante → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/inexistante');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'serie_not_found');
});

test('GET /api/series/:serie/:folder/:name → 200', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/onepiece/comics/c_a');
  assert.equal(res.status, 200);
  assert.equal(res.body.pages.length, 2);
});

test('GET /api/series/:serie/comics/:name/suggestions → 200', async () => {
  app = makeApp();
  const res = await request(app).get('/api/series/onepiece/comics/c_a/suggestions');
  assert.equal(res.status, 200);
  assert.equal(res.body.suggestions.length, 1);
  assert.equal(res.body.suggestions[0].name, 'c_b');
});

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
});