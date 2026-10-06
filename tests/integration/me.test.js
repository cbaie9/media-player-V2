'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

const { buildApiRouter } = require('../../src/routes/api');

let app;

function makeApp({ user = null } = {}) {
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

  // Middleware de session simulée
  a.use((req, res, next) => {
    if (user) req.session.user = user;
    next();
  });

  // Store minimal
  const fakeStore = {
    series: {},
    error: null,
    listSeries: () => [],
    getSerie: () => null,
    getComics: () => null,
    rescan: () => ({ seriesCount: 0, comicsCount: 0, warningsCount: 0, durationMs: 0 }),
  };

  a.use('/api', buildApiRouter({ store: fakeStore }));
  return a;
}

beforeEach(() => {
  app = null;
});

test('GET /api/me avec session reader → 200 { role: "reader" }', async () => {
  app = makeApp({ user: { username: 'reader', role: 'reader' } });
  const res = await request(app).get('/api/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: 'reader', role: 'reader' });
});

test('GET /api/me avec session admin → 200 { role: "admin" }', async () => {
  app = makeApp({ user: { username: 'admin', role: 'admin' } });
  const res = await request(app).get('/api/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: 'admin', role: 'admin' });
});

test('GET /api/me sans session → 401 unauthorized', async () => {
  app = makeApp({ user: null });
  const res = await request(app).get('/api/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('GET /api/me : la réponse a la forme { username, role }', async () => {
  app = makeApp({ user: { username: 'reader', role: 'reader' } });
  const res = await request(app).get('/api/me');
  const keys = Object.keys(res.body).sort();
  assert.deepEqual(keys, ['role', 'username']);
  assert.equal(typeof res.body.username, 'string');
  assert.equal(typeof res.body.role, 'string');
});