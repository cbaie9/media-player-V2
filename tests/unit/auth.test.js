'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const {
  verifyCredentials,
  requireAuth,
  requireAdmin,
  wantsJson,
  buildSessionOptions,
  DUMMY_HASH,
} = require('../../src/auth');

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------

async function makeUsers() {
  return {
    reader: { password_hash: await bcrypt.hash('reader_pw', 4) },
    admin: { password_hash: await bcrypt.hash('admin_pw', 4) },
  };
}

function mockReq({
  session = null,
  path: p = '/',
  originalUrl = null,
  accept = '',
} = {}) {
  return {
    session,
    path: p,
    originalUrl: originalUrl || p,
    url: originalUrl || p,
    headers: { accept },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null,
    _redirect: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this._json = obj;
      return this;
    },
    redirect(code, to) {
      this.statusCode = code;
      this._redirect = to;
      return this;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// verifyCredentials
// ---------------------------------------------------------------------------

test('verifyCredentials accepte un bon couple', async () => {
  const users = await makeUsers();
  const r = await verifyCredentials({
    users,
    username: 'reader',
    password: 'reader_pw',
  });
  assert.deepEqual(r, { ok: true, username: 'reader' });
});

test('verifyCredentials rejette un mauvais mot de passe', async () => {
  const users = await makeUsers();
  const r = await verifyCredentials({
    users,
    username: 'reader',
    password: 'nope',
  });
  assert.equal(r.ok, false);
});

test('verifyCredentials rejette un utilisateur inconnu', async () => {
  const users = await makeUsers();
  const r = await verifyCredentials({
    users,
    username: 'ghost',
    password: 'x',
  });
  assert.equal(r.ok, false);
});

test('verifyCredentials utilise DUMMY_HASH si user inexistant', async () => {
  const users = await makeUsers();
  const origCompare = bcrypt.compare;
  let called = 0;
  bcrypt.compare = async (pw, hash) => {
    called++;
    assert.equal(hash, DUMMY_HASH);
    return false;
  };
  try {
    await verifyCredentials({ users, username: 'ghost', password: 'x' });
    assert.equal(called, 1);
  } finally {
    bcrypt.compare = origCompare;
  }
});

test('verifyCredentials tolère un username non-string', async () => {
  const users = await makeUsers();
  const r = await verifyCredentials({ users, username: null, password: 'x' });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// wantsJson (bug #1 : originalUrl vs path)
// ---------------------------------------------------------------------------

test('wantsJson true pour /api/* avec originalUrl', () => {
  // Cas réel : routeur monté sur /api → req.path = '/series' mais
  // req.originalUrl = '/api/series'
  const req = mockReq({ path: '/series', originalUrl: '/api/series' });
  assert.equal(wantsJson(req), true);
});

test('wantsJson true pour /media/* avec originalUrl', () => {
  const req = mockReq({
    path: '/onepiece/comics/x-0001.png',
    originalUrl: '/media/onepiece/comics/x-0001.png',
  });
  assert.equal(wantsJson(req), true);
});

test('wantsJson false pour une route HTML classique', () => {
  const req = mockReq({ path: '/', originalUrl: '/' });
  assert.equal(wantsJson(req), false);
});

test('wantsJson true si Accept: application/json', () => {
  const req = mockReq({ path: '/', originalUrl: '/', accept: 'application/json' });
  assert.equal(wantsJson(req), true);
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

test('requireAuth 302 vers /login si pas de session (HTML)', () => {
  const mw = requireAuth();
  const req = mockReq({ session: null, path: '/', originalUrl: '/' });
  const res = mockRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 302);
  assert.equal(res._redirect, '/login');
});

test('requireAuth 401 JSON pour /api/* (même monté sur routeur)', () => {
  const mw = requireAuth();
  // Simulation exacte du bug : path réécrit, originalUrl conservé
  const req = mockReq({
    session: null,
    path: '/series',
    originalUrl: '/api/series',
  });
  const res = mockRes();

  mw(req, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res._json, { error: 'unauthorized' });
});

test('requireAuth 401 pour /media/* (même monté sur routeur)', () => {
  const mw = requireAuth();
  const req = mockReq({
    session: null,
    path: '/onepiece/comics/x-0001.png',
    originalUrl: '/media/onepiece/comics/x-0001.png',
  });
  const res = mockRes();

  mw(req, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res._json, { error: 'unauthorized' });
});

test('requireAuth passe si session.user existe', () => {
  const mw = requireAuth();
  const req = mockReq({ session: { user: { username: 'reader' } } });
  const res = mockRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

test('requireAdmin 403 si rôle ≠ admin', () => {
  const mw = requireAdmin();
  const req = mockReq({
    session: { user: { username: 'reader', role: 'reader' } },
  });
  const res = mockRes();

  mw(req, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res._json, { error: 'forbidden' });
});

test('requireAdmin passe si rôle admin', () => {
  const mw = requireAdmin();
  const req = mockReq({
    session: { user: { username: 'admin', role: 'admin' } },
  });
  const res = mockRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

// ---------------------------------------------------------------------------
// buildSessionOptions
// ---------------------------------------------------------------------------

test('buildSessionOptions pose cookie HttpOnly + SameSite=Strict', () => {
  const opts = buildSessionOptions({
    sessionSecret: 'x'.repeat(64),
    sessionMaxAgeHours: 24,
    https: false,
  });
  assert.equal(opts.cookie.httpOnly, true);
  assert.equal(opts.cookie.sameSite, 'strict');
  assert.equal(opts.cookie.secure, false);
  assert.equal(opts.cookie.maxAge, 24 * 3600 * 1000);
  assert.equal(opts.name, 'connect.sid');
});

test('buildSessionOptions active Secure si HTTPS', () => {
  const opts = buildSessionOptions({
    sessionSecret: 'x'.repeat(64),
    sessionMaxAgeHours: 1,
    https: true,
  });
  assert.equal(opts.cookie.secure, true);
  assert.equal(opts.cookie.maxAge, 3600 * 1000);
});