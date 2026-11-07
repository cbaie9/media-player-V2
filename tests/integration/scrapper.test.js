'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');

const { buildAuthRouter, buildSessionOptions } = require('../../src/auth');
const { buildScrapperRouter } = require('../../src/scrapper');
const { LoginRateLimiter } = require('../../src/security');

const FAKE_SCRAPPER = path.resolve(
  __dirname, '..', 'fixtures', 'fake_scrapper.js'
);

const SESSION_SECRET = 'test-secret-32-chars-minimum-xxxxxxxx';

let server;
let port;
let cookieAdmin;
let cookieReader;

// V1.6 — ROOT_DIR temporaire + scan cache stub
let tmpRoot;
let users;

/**
 * Store factice pour l'intégration.
 *  - listSeries(role) : séries visibles par le rôle.
 *  - getSerie(name, role) : objet série ou null.
 *
 * Reproduit le filtrage admin-only du vrai store.
 */
function buildFakeStore() {
  const SERIES = ['onepiece', 'naruto', 'admin_series'];
  const ADMIN_ONLY = new Set(['admin_series']);

  return {
    listSeries(role) {
      const visible = SERIES.filter((n) =>
        role === 'admin' ? true : !ADMIN_ONLY.has(n),
      );
      return visible.map((name) => ({ name }));
    },
    getSerie(name, role) {
      if (!SERIES.includes(name)) return null;
      if (role !== 'admin' && ADMIN_ONLY.has(name)) return null;
      return { name };
    },
  };
}

function buildConfig(overrides = {}) {
  return {
    ROOT_DIR: tmpRoot,
    python_module: {
      script_path: FAKE_SCRAPPER,
      python_executable: process.execPath,
      cwd: path.dirname(FAKE_SCRAPPER),
      timeout_seconds: 10,
      max_concurrent_per_session: 1,
      max_concurrent_global: 3,
      allowed_roles: ['admin'],
      rate_limit: { windowMinutes: 5, maxAttempts: 100 },
      create_dest_if_missing: true,
    },
    python_module_disabled_reason: null,
    ...overrides,
  };
}

function buildApp(config, storeStub) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(
    session(
      buildSessionOptions({
        sessionSecret: SESSION_SECRET,
        sessionMaxAgeHours: 1,
        https: false,
      }),
    ),
  );
  const rateLimiter = new LoginRateLimiter({ maxAttempts: 5 });
  app.use(buildAuthRouter({ users, rateLimiter }));
  app.use(buildScrapperRouter({ config, store: storeStub }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function postForm(targetPort, targetPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(data),
    };
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port: targetPort, path: targetPath, method: 'POST', headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: raw }),
        );
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function login(targetPort, username, password) {
  const res = await postForm(targetPort, '/login', { username, password });
  assert.equal(res.status, 302);
  const setCookie = res.headers['set-cookie'] || [];
  const cookie = setCookie.find((c) => c.startsWith('connect.sid='));
  assert.ok(cookie, 'cookie de session attendu');
  return cookie.split(';')[0];
}

/**
 * Consomme une réponse HTTP : SSE si `text/event-stream`, sinon JSON.
 * `port` peut être override pour tester un second app.
 */
function consumeSSE(targetPath, cookie, { abortAfterMs, port: overridePort } = {}) {
  const targetPort = overridePort || port;
  return new Promise((resolve, reject) => {
    const frames = [];
    let buffer = '';
    let statusCode;
    let contentType = '';
    let resolved = false;

    const finalize = (payload) => {
      if (resolved) return;
      resolved = true;
      resolve(payload);
    };

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: targetPath,
        method: 'GET',
        headers: { Accept: 'text/event-stream', Cookie: cookie || '' },
      },
      (res) => {
        statusCode = res.statusCode;
        contentType = String(res.headers['content-type'] || '');
        const isSSE = contentType.startsWith('text/event-stream');

        if (!isSSE) {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let body = null;
            try {
              body = JSON.parse(raw);
            } catch {
              body = raw ? { raw } : null;
            }
            finalize({ status: statusCode, body, frames: [], contentType });
          });
          return;
        }

        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const evt = parseFrame(block);
            if (evt) frames.push(evt);
          }
        });
        res.on('end', () => {
          finalize({ status: statusCode, body: null, frames, contentType });
        });
      },
    );

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') return;
      reject(err);
    });

    if (abortAfterMs) {
      setTimeout(() => {
        try { req.destroy(); } catch { /* ignore */ }
        setTimeout(() => {
          finalize({ status: statusCode, body: null, frames, aborted: true });
        }, 300);
      }, abortAfterMs);
    }

    req.end();
  });
}

function parseFrame(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapper-it-'));
  // Série 'onepiece' existe (dossier physique présent)
  fs.mkdirSync(path.join(tmpRoot, 'onepiece'), { recursive: true });
  // Série 'naruto' existe physiquement mais pas de sous-dossier comics
  fs.mkdirSync(path.join(tmpRoot, 'naruto'), { recursive: true });
  // 'admin_series' n'existe que côté scan cache (pas de dossier physique
  // nécessaire : store.getSerie le renvoie, mkdir créera le path réel).

  users = {
    reader: { password_hash: await bcrypt.hash('reader_pw', 4) },
    admin: { password_hash: await bcrypt.hash('admin_pw', 4) },
  };

  const app = buildApp(buildConfig(), buildFakeStore());
  server = await listen(app);
  port = server.address().port;

  cookieAdmin = await login(port, 'admin', 'admin_pw');
  cookieReader = await login(port, 'reader', 'reader_pw');
});

after(() => {
  if (server) server.close();
  if (tmpRoot) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// /api/scrapper/config
// ---------------------------------------------------------------------------

test('GET /api/scrapper/config sans session → 401', async () => {
  const { status } = await consumeSSE('/api/scrapper/config', null);
  assert.equal(status, 401);
});

test('GET /api/scrapper/config admin → enabled + allowed + series + folders + rootDir', async () => {
  const { status, body } = await consumeSSE('/api/scrapper/config', cookieAdmin);
  assert.equal(status, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.allowed, true);
  assert.deepEqual(body.roles, ['admin']);
  assert.deepEqual(body.series, ['onepiece', 'naruto', 'admin_series']);
  assert.deepEqual(body.folders, ['comics', 'comics_admin', 'img', 'img_admin']);
  assert.equal(body.rootDir, path.resolve(tmpRoot));
});

test('GET /api/scrapper/config reader → allowed:false + pas de fuite series/folders', async () => {
  const { status, body } = await consumeSSE('/api/scrapper/config', cookieReader);
  assert.equal(status, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.allowed, false);
  assert.equal(body.reason, 'forbidden_role');
  assert.deepEqual(body.roles, ['admin']);
  assert.equal(body.series, undefined);
  assert.equal(body.folders, undefined);
  assert.equal(body.rootDir, undefined);
});

// ---------------------------------------------------------------------------
// /api/run — auth + validations
// ---------------------------------------------------------------------------

test('GET /api/run sans session → 401', async () => {
  const { status } = await consumeSSE(
    '/api/run?url=ok&series_dest=onepiece&folder_dest=comics',
    null,
  );
  assert.equal(status, 401);
});

test('GET /api/run reader → 403 (avant toute validation)', async () => {
  const { status, body } = await consumeSSE('/api/run?url=ok', cookieReader);
  assert.equal(status, 403);
  assert.equal(body.error, 'forbidden');
});

test('GET /api/run sans url → 400 missing_url', async () => {
  const { status, body } = await consumeSSE(
    '/api/run?series_dest=onepiece&folder_dest=comics',
    cookieAdmin,
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'missing_url');
});

test('GET /api/run url trop longue → 400 url_too_long', async () => {
  const longUrl = 'x'.repeat(3000);
  const { status, body } = await consumeSSE(
    '/api/run?url=' + encodeURIComponent(longUrl) +
      '&series_dest=onepiece&folder_dest=comics',
    cookieAdmin,
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'url_too_long');
});

test('GET /api/run sans series_dest → 400 missing_series_dest', async () => {
  const { status, body } = await consumeSSE(
    '/api/run?url=ok&folder_dest=comics',
    cookieAdmin,
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'missing_series_dest');
});

test('GET /api/run series_dest avec / → 400 invalid_series_dest', async () => {
  const { status, body } = await consumeSSE(
    '/api/run?url=ok&series_dest=..%2Fetc&folder_dest=comics',
    cookieAdmin,
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_series_dest');
});

test('GET /api/run series_dest=".." → 400 invalid_series_dest', async () => {
  const { status, body } = await consumeSSE(
    '/api/run?url=ok&series_dest=..&folder_dest=comics',
    cookieAdmin,
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_series_dest');
});

test('GET /api/run sans folder_dest → 400 missing_folder_dest', async () => {
  const { status, body } = await consumeSSE(
    '/api/run?url=ok&series_dest=onepiece',
    cookieAdmin,
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'missing_folder_dest');
});

test('GET /api/run folder_dest invalide → 400 invalid_folder_dest', async () => {
  const { status, body } = await consumeSSE(
    '/api/run?url=ok&series_dest=onepiece&folder_dest=other',
    cookieAdmin,
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_folder_dest');
});

test('GET /api/run série inconnue → 404 unknown_series', async () => {
  const { status, body } = await consumeSSE(
    '/api/run?url=ok&series_dest=inexistante&folder_dest=comics',
    cookieAdmin,
  );
  assert.equal(status, 404);
  assert.equal(body.error, 'unknown_series');
});

// ---------------------------------------------------------------------------
// /api/run — flux SSE + création dossier destination
// ---------------------------------------------------------------------------

test('GET /api/run succès → SSE complet, dossier créé, end "ok"', async () => {
  // Pré-conditions
  const destPath = path.join(tmpRoot, 'onepiece', 'comics');
  assert.equal(fs.existsSync(destPath), false, 'dest ne doit pas exister avant');

  const { status, frames } = await consumeSSE(
    '/api/run?url=ok&series_dest=onepiece&folder_dest=comics',
    cookieAdmin,
  );
  assert.equal(status, 200);
  assert.ok(frames.length > 0, 'frames SSE attendues');

  assert.equal(frames[0].event, 'meta');
  assert.equal(frames[0].data.dest, destPath);
  assert.equal(frames[0].data.seriesDest, 'onepiece');
  assert.equal(frames[0].data.folderDest, 'comics');

  const phase3Done = frames.find(
    (f) => f.event === 'phase' && f.data.phase === 3 && f.data.progress === 100,
  );
  assert.ok(phase3Done, 'phase 3 devrait atteindre 100');

  const end = frames[frames.length - 1];
  assert.equal(end.event, 'end');
  assert.equal(end.data.reason, 'ok');
  assert.equal(end.data.exitCode, 0);

  // Le serveur a créé le dossier destination
  assert.equal(fs.existsSync(destPath), true, 'dest doit exister après le run');
});

test('GET /api/run échec phase 2 → phase error + end "error"', async () => {
  const { status, frames } = await consumeSSE(
    '/api/run?url=fail-phase-2&series_dest=naruto&folder_dest=img',
    cookieAdmin,
  );
  assert.equal(status, 200);

  const phaseErr = frames.find(
    (f) => f.event === 'phase' && f.data.phase === 2 && f.data.status === 'error',
  );
  assert.ok(phaseErr, 'phase 2 devrait être marquée en erreur');

  const end = frames[frames.length - 1];
  assert.equal(end.event, 'end');
  assert.equal(end.data.reason, 'error');
});

test('GET /api/run abort client → le process doit être tué', async () => {
  const { aborted } = await consumeSSE(
    '/api/run?url=long&series_dest=onepiece&folder_dest=img',
    cookieAdmin,
    { abortAfterMs: 500 },
  );
  assert.ok(aborted, 'on doit avoir aborté');

  await new Promise((r) => setTimeout(r, 600));

  const { status } = await consumeSSE(
    '/api/run?url=ok&series_dest=onepiece&folder_dest=img',
    cookieAdmin,
    { abortAfterMs: 5000 },
  );
  assert.equal(status, 200, 'le second run doit être accepté (pas de zombie)');
});

// ---------------------------------------------------------------------------
// /api/run — create_dest_if_missing=false
// ---------------------------------------------------------------------------

test('create_dest_if_missing=false + dest absente → 404 dest_missing', async () => {
  const tmpRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapper-it-nocreate-'));
  try {
    fs.mkdirSync(path.join(tmpRoot2, 'onepiece'), { recursive: true });

    const cfg2 = buildConfig({ ROOT_DIR: tmpRoot2 });
    cfg2.python_module.create_dest_if_missing = false;

    const app2 = buildApp(cfg2, buildFakeStore());
    const server2 = await listen(app2);
    const port2 = server2.address().port;

    try {
      const cookie = await login(port2, 'admin', 'admin_pw');
      const { status, body } = await consumeSSE(
        '/api/run?url=ok&series_dest=onepiece&folder_dest=comics',
        cookie,
        { port: port2 },
      );
      assert.equal(status, 404);
      assert.equal(body.error, 'dest_missing');

      // Le dossier ne doit PAS avoir été créé
      assert.equal(
        fs.existsSync(path.join(tmpRoot2, 'onepiece', 'comics')),
        false,
        'dest ne doit pas être créée',
      );
    } finally {
      server2.close();
    }
  } finally {
    fs.rmSync(tmpRoot2, { recursive: true, force: true });
  }
});