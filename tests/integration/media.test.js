'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

const { buildMediaRouter } = require('../../src/routes/media');

let app;
let ROOT;

function makeApp({ authenticated = true } = {}) {
  const a = express();
  a.use(
    session({
      secret: 'x'.repeat(64),
      resave: false,
      saveUninitialized: false,
      name: 'connect.sid',
    })
  );
  a.use((req, res, next) => {
    if (authenticated) req.session.user = { username: 'reader', role: 'reader' };
    next();
  });
  a.use('/media', buildMediaRouter({ rootDir: ROOT, logger: null }));
  return a;
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-media-'));
  ROOT = path.join(dir, 'root');
  fs.mkdirSync(path.join(ROOT, 'onepiece', 'comics'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'onepiece', 'comics', 'c_a-0001.png'),
    Buffer.from('0123456789'.repeat(10)) // 100 octets
  );
});

test('GET /media valide → 200', async () => {
  app = makeApp();
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['cache-control'], 'private, max-age=3600');
  assert.equal(res.headers['accept-ranges'], 'bytes');
});

test('GET /media sans session → 401', async () => {
  app = makeApp({ authenticated: false });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.png');
  assert.equal(res.status, 401);
});

test('GET /media avec Range → 206', async () => {
  app = makeApp();
  const res = await request(app)
    .get('/media/onepiece/comics/c_a-0001.png')
    .set('Range', 'bytes=0-9');
  assert.equal(res.status, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-9/100');
  assert.equal(res.headers['content-length'], '10');
});

test('GET /media fichier inexistant → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/media/onepiece/comics/zzz-0001.png');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'file_not_found');
});

test('GET /media nom non conforme → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/media/onepiece/comics/readme.txt');
  assert.equal(res.status, 404);
});

test('GET /media folder invalide → 404', async () => {
  app = makeApp();
  const res = await request(app).get('/media/onepiece/video/c_a-0001.png');
  assert.equal(res.status, 404);
});

test('GET /media path traversal → 403 ou 404', async () => {
  app = makeApp();
  // Les segments avec .. seront refusés par la validation amont
  const res = await request(app).get('/media/onepiece/comics/..%2F..%2Fetc%2Fpasswd');
  assert.ok([403, 404].includes(res.status));
});