'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

const { buildAuthRouter, buildSessionOptions } = require('../../src/auth');
const { LoginRateLimiter } = require('../../src/security');

let users;
let rateLimiter;

function makeApp({ maxAttempts = 5 } = {}) {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use(
    session(
      buildSessionOptions({
        sessionSecret: 'x'.repeat(64),
        sessionMaxAgeHours: 24,
        https: false,
      })
    )
  );

  rateLimiter = new LoginRateLimiter({ maxAttempts });

  app.use(
    buildAuthRouter({
      users,
      rateLimiter,
    })
  );

  // Route protégée pour tester le cycle login → accès
  app.get('/', (req, res) => {
    if (!req.session.user) return res.status(401).send('unauthorized');
    res.send(`hello ${req.session.user.username}`);
  });

  return app;
}

beforeEach(async () => {
  users = {
    reader: { password_hash: await bcrypt.hash('reader_pw', 4) },
    admin: { password_hash: await bcrypt.hash('admin_pw', 4) },
  };
});

// ---------------------------------------------------------------------------
// POST /login — succès
// ---------------------------------------------------------------------------

test('POST /login valide → 302 + cookie', async () => {
  const app = makeApp();
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'reader', password: 'reader_pw' });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');

  const setCookie = res.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie) && setCookie.length > 0);
  assert.match(setCookie[0], /connect\.sid=/);
  assert.match(setCookie[0], /HttpOnly/i);
  assert.match(setCookie[0], /SameSite=Strict/i);
});

test('POST /login admin → 302', async () => {
  const app = makeApp();
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'admin', password: 'admin_pw' });

  assert.equal(res.status, 302);
});

// ---------------------------------------------------------------------------
// POST /login — échecs
// ---------------------------------------------------------------------------

test('POST /login mauvais mdp → 401 invalid_credentials', async () => {
  const app = makeApp();
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'reader', password: 'wrong' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
});

test('POST /login utilisateur inconnu → 401', async () => {
  const app = makeApp();
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'ghost', password: 'x' });

  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Rate limit (E2)
// ---------------------------------------------------------------------------

test('5 échecs → 429 sur le 6e essai', async () => {
  const app = makeApp({ maxAttempts: 5 });

  for (let i = 0; i < 5; i++) {
    await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'reader', password: 'wrong' });
  }

  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'reader', password: 'wrong' });

  assert.equal(res.status, 429);
  assert.equal(res.body.error, 'too_many_attempts');
  assert.ok(typeof res.body.retryAfterSeconds === 'number');
  assert.ok(res.body.retryAfterSeconds > 0);
});

test('login réussi reset le rate limit', async () => {
  const app = makeApp({ maxAttempts: 5 });

  // 3 échecs
  for (let i = 0; i < 3; i++) {
    await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'reader', password: 'wrong' });
  }

  // Un succès
  const ok = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'reader', password: 'reader_pw' });
  assert.equal(ok.status, 302);

  // Le compteur doit être reset : 5 nouveaux essais possibles
  for (let i = 0; i < 5; i++) {
    const r = await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'reader', password: 'wrong' });
    assert.equal(r.status, 401, `essai ${i} devrait être 401`);
  }
});

// ---------------------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------------------

test('POST /logout détruit la session', async () => {
  const app = makeApp();

  const agent = request.agent(app);

  // Login
  const login = await agent
    .post('/login')
    .type('form')
    .send({ username: 'reader', password: 'reader_pw' });
  assert.equal(login.status, 302);

  // Accès protégé OK
  const before = await agent.get('/');
  assert.equal(before.status, 200);

  // Logout
  const out = await agent.post('/logout');
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });

  // Accès protégé refusé
  const after = await agent.get('/');
  assert.equal(after.status, 401);
});

// ---------------------------------------------------------------------------
// Cookie : attributs de sécurité (§6.3)
// ---------------------------------------------------------------------------

test('cookie de session : HttpOnly + SameSite=Strict', async () => {
  const app = makeApp();
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'reader', password: 'reader_pw' });

  const cookies = res.headers['set-cookie'].join('; ');
  assert.match(cookies, /HttpOnly/i);
  assert.match(cookies, /SameSite=Strict/i);
});