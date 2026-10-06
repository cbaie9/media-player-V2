'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { requireAuth, wantsJson } = require('../../src/auth');

// ---------------------------------------------------------------------------
// wantsJson
// ---------------------------------------------------------------------------

test('wantsJson : /api/* → true', () => {
  assert.equal(wantsJson({ originalUrl: '/api/me', headers: {} }), true);
  assert.equal(wantsJson({ originalUrl: '/api/series', headers: {} }), true);
});

test('wantsJson : /media/* → true', () => {
  assert.equal(wantsJson({ originalUrl: '/media/a/b/c.png', headers: {} }), true);
});

test('wantsJson : route HTML → false', () => {
  assert.equal(wantsJson({ originalUrl: '/serie/onepiece', headers: {} }), false);
  assert.equal(wantsJson({ originalUrl: '/', headers: {} }), false);
});

test('wantsJson : header Accept JSON → true', () => {
  assert.equal(
    wantsJson({ originalUrl: '/foo', headers: { accept: 'application/json' } }),
    true
  );
});

// ---------------------------------------------------------------------------
// requireAuth sur /api/*
// ---------------------------------------------------------------------------

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    redirect(code, url) {
      this.statusCode = code;
      this.redirectUrl = url;
      return this;
    },
  };
}

test('requireAuth sur /api/me sans session → 401 JSON', () => {
  const mw = requireAuth();
  const req = { originalUrl: '/api/me', session: {} };
  const res = fakeRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthorized' });
});

test('requireAuth sur /api/me avec session.user → next()', () => {
  const mw = requireAuth();
  const req = {
    originalUrl: '/api/me',
    session: { user: { username: 'reader', role: 'reader' } },
  };
  const res = fakeRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('requireAuth sur route HTML sans session → redirect 302 /login', () => {
  const mw = requireAuth();
  const req = { originalUrl: '/serie/onepiece', session: {} };
  const res = fakeRes();
  let nextCalled = false;

  mw(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectUrl, '/login');
});