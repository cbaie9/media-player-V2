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

// V1.5.2 — Enregistrement MIME une seule fois pour le process de test
// (équivalent de ce que fait app.js côté serveur).
express.static.mime.define({
  'image/jxl': ['jxl'],
  'image/avif': ['avif'],
});

function makeApp({ role = 'reader', authenticated = true } = {}) {
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
    if (authenticated) req.session.user = { username: role, role };
    next();
  });
  a.use('/media', buildMediaRouter({ rootDir: ROOT, logger: null }));
  return a;
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-media-'));
  ROOT = path.join(dir, 'root');

  const w = (rel) => {
    const abs = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from('0123456789'.repeat(10))); // 100 octets
  };

  w('onepiece/comics/c_a-0001.png');
  w('onepiece/comics_admin/secret-0001.png');
  w('onepiece/img/cover-0001.png');
  w('onepiece/img_admin/secret-0001.png');

  // V1.5.2 — formats image modernes
  w('onepiece/comics/c_a-0001.jxl');
  w('onepiece/comics/c_a-0001.avif');
  w('onepiece/comics_admin/secret-0001.jxl');
  w('onepiece/comics_admin/secret-0001.avif');
});

// ---------------------------------------------------------------------------
// Fichiers normaux — accessibles aux 2 rôles
// ---------------------------------------------------------------------------

test('GET /media (reader, comics) → 200', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['cache-control'], 'private, max-age=3600');
  assert.equal(res.headers['accept-ranges'], 'bytes');
});

test('GET /media (admin, comics) → 200', async () => {
  app = makeApp({ role: 'admin' });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.png');
  assert.equal(res.status, 200);
});

test('GET /media (reader, img) → 200', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get('/media/onepiece/img/cover-0001.png');
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// V1.2 — Dossiers _admin : accès restreint au rôle admin
// ---------------------------------------------------------------------------

test('GET /media (reader, comics_admin) → 404 (comme si inexistant)', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get(
    '/media/onepiece/comics_admin/secret-0001.png'
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'file_not_found');
});

test('GET /media (reader, img_admin) → 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get(
    '/media/onepiece/img_admin/secret-0001.png'
  );
  assert.equal(res.status, 404);
});

test('GET /media (admin, comics_admin) → 200', async () => {
  app = makeApp({ role: 'admin' });
  const res = await request(app).get(
    '/media/onepiece/comics_admin/secret-0001.png'
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
});

test('GET /media (admin, img_admin) → 200', async () => {
  app = makeApp({ role: 'admin' });
  const res = await request(app).get(
    '/media/onepiece/img_admin/secret-0001.png'
  );
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// Range, auth, invalides
// ---------------------------------------------------------------------------

test('GET /media sans session → 401', async () => {
  app = makeApp({ authenticated: false });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.png');
  assert.equal(res.status, 401);
});

test('GET /media avec Range → 206', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app)
    .get('/media/onepiece/comics/c_a-0001.png')
    .set('Range', 'bytes=0-9');
  assert.equal(res.status, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-9/100');
  assert.equal(res.headers['content-length'], '10');
});

test('GET /media fichier inexistant → 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get('/media/onepiece/comics/zzz-0001.png');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'file_not_found');
});

test('GET /media nom non conforme → 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get('/media/onepiece/comics/readme.txt');
  assert.equal(res.status, 404);
});

test('GET /media folder invalide → 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get('/media/onepiece/video/c_a-0001.png');
  assert.equal(res.status, 404);
});

test('GET /media path traversal → 403 ou 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get(
    '/media/onepiece/comics/..%2F..%2Fetc%2Fpasswd'
  );
  assert.ok([403, 404].includes(res.status));
});

// ---------------------------------------------------------------------------
// V1.5.2 — Formats image modernes : .jxl (JPEG XL) et .avif (AVIF)
// ---------------------------------------------------------------------------

test('GET /media .jxl (reader, comics) → 200 + image/jxl', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.jxl');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/jxl');
  assert.equal(res.headers['content-length'], '100');
});

test('GET /media .avif (reader, comics) → 200 + image/avif', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.avif');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/avif');
  assert.equal(res.headers['content-length'], '100');
});

test('GET /media .jxl (admin, comics) → 200', async () => {
  app = makeApp({ role: 'admin' });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.jxl');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/jxl');
});

test('GET /media .avif (admin, comics) → 200', async () => {
  app = makeApp({ role: 'admin' });
  const res = await request(app).get('/media/onepiece/comics/c_a-0001.avif');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/avif');
});

test('GET /media .jxl avec Range → 206 + Content-Range', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app)
    .get('/media/onepiece/comics/c_a-0001.jxl')
    .set('Range', 'bytes=0-9');
  assert.equal(res.status, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-9/100');
  assert.equal(res.headers['content-length'], '10');
});

test('GET /media .avif avec Range → 206 + Content-Range', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app)
    .get('/media/onepiece/comics/c_a-0001.avif')
    .set('Range', 'bytes=0-9');
  assert.equal(res.status, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-9/100');
});

test('GET /media .jxl (reader, comics_admin) → 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get(
    '/media/onepiece/comics_admin/secret-0001.jxl'
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'file_not_found');
});

test('GET /media .avif (reader, comics_admin) → 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get(
    '/media/onepiece/comics_admin/secret-0001.avif'
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'file_not_found');
});

test('GET /media .jxl (admin, comics_admin) → 200', async () => {
  app = makeApp({ role: 'admin' });
  const res = await request(app).get(
    '/media/onepiece/comics_admin/secret-0001.jxl'
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/jxl');
});

test('GET /media .avif (admin, comics_admin) → 200', async () => {
  app = makeApp({ role: 'admin' });
  const res = await request(app).get(
    '/media/onepiece/comics_admin/secret-0001.avif'
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/avif');
});

test('GET /media .jxl path traversal → 403 ou 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get(
    '/media/onepiece/comics/..%2F..%2Fetc%2Fpasswd.jxl'
  );
  assert.ok([403, 404].includes(res.status));
});

test('GET /media .avif path traversal → 403 ou 404', async () => {
  app = makeApp({ role: 'reader' });
  const res = await request(app).get(
    '/media/onepiece/comics/..%2F..%2Fetc%2Fpasswd.avif'
  );
  assert.ok([403, 404].includes(res.status));
});