'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

let server;
let port;
let cookieAdmin;
let cookieReader;

function buildConfig() {
  return {
    python_module: {
      script_path: FAKE_SCRAPPER,
      python_executable: process.execPath,
      cwd: path.dirname(FAKE_SCRAPPER),
      timeout_seconds: 10,
      max_concurrent_per_session: 1,
      max_concurrent_global: 3,
      allowed_roles: ['admin'],
      rate_limit: { windowMinutes: 5, maxAttempts: 100 },
    },
    python_module_disabled_reason: null,
  };
}

before(async () => {
  const users = {
    reader: { password_hash: await bcrypt.hash('reader_pw', 4) },
    admin: { password_hash: await bcrypt.hash('admin_pw', 4) },
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(
    session(
      buildSessionOptions({
        sessionSecret: 'test-secret-32-chars-minimum-xxxxxxxx',
        sessionMaxAgeHours: 1,
        https: false,
      })
    )
  );
  const rateLimiter = new LoginRateLimiter({ maxAttempts: 5 });
  app.use(buildAuthRouter({ users, rateLimiter }));
  app.use(buildScrapperRouter({ config: buildConfig() }));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });

  cookieAdmin = await login('admin', 'admin_pw');
  cookieReader = await login('reader', 'reader_pw');
});

after(() => {
  if (server) server.close();
});

function postForm(path, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: raw })
        );
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function login(username, password) {
  const res = await postForm('/login', { username, password });
  assert.equal(res.status, 302);
  const setCookie = res.headers['set-cookie'] || [];
  const cookie = setCookie.find((c) => c.startsWith('connect.sid='));
  assert.ok(cookie, 'cookie de session attendu');
  return cookie.split(';')[0];
}

/**
 * Consomme une réponse HTTP.
 *  - Si `Content-Type` commence par `text/event-stream` → parse les frames SSE.
 *  - Sinon → parse le body comme JSON (ou texte brut).
 *
 * Abort le client après `abortAfterMs` si fourni (utile pour tester
 * le kill on disconnect).
 */
function consumeSSE(path, cookie, { abortAfterMs } = {}) {
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
        port,
        path,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Cookie: cookie || '',
        },
      },
      (res) => {
        statusCode = res.statusCode;
        contentType = String(res.headers['content-type'] || '');

        const isSSE = contentType.startsWith('text/event-stream');

        // Branche NON-SSE : on accumule le body brut.
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

        // Branche SSE : on parse les frames à la volée.
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
      }
    );

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') {
        // Abort côté client : on considère que c'est voulu.
        return; // laissera le setTimeout ci-dessous résoudre
      }
      reject(err);
    });

    if (abortAfterMs) {
      setTimeout(() => {
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        // Laisser au serveur le temps de détecter res.close + tuer le child
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
// /api/scrapper/config
// ---------------------------------------------------------------------------

test('GET /api/scrapper/config sans session → 401 JSON', async () => {
  const { status } = await consumeSSE('/api/scrapper/config', null);
  assert.equal(status, 401);
});

test('GET /api/scrapper/config avec session admin → enabled + roles', async () => {
  const { status, body } = await consumeSSE('/api/scrapper/config', cookieAdmin);
  assert.equal(status, 200);
  assert.ok(body, 'body JSON attendu');
  assert.equal(body.enabled, true);
  assert.deepEqual(body.roles, ['admin']);
});

test('GET /api/scrapper/config avec session reader → 200 (mais pas autorisé)', async () => {
  const { status, body } = await consumeSSE('/api/scrapper/config', cookieReader);
  assert.equal(status, 200);
  assert.ok(body, 'body JSON attendu');
  assert.equal(body.enabled, true);
  assert.deepEqual(body.roles, ['admin']);
});

// ---------------------------------------------------------------------------
// /api/run — validation
// ---------------------------------------------------------------------------

test('GET /api/run sans session → 401', async () => {
  const { status } = await consumeSSE('/api/run?url=ok', null);
  assert.equal(status, 401);
});

test('GET /api/run reader → 403', async () => {
  const { status, body } = await consumeSSE('/api/run?url=ok', cookieReader);
  assert.equal(status, 403);
  assert.equal(body.error, 'forbidden');
});

test('GET /api/run sans url → 400', async () => {
  const { status, body } = await consumeSSE('/api/run', cookieAdmin);
  assert.equal(status, 400);
  assert.equal(body.error, 'missing_url');
});

test('GET /api/run url trop longue → 400', async () => {
  const longUrl = 'x'.repeat(3000);
  const { status, body } = await consumeSSE(
    '/api/run?url=' + encodeURIComponent(longUrl),
    cookieAdmin
  );
  assert.equal(status, 400);
  assert.equal(body.error, 'url_too_long');
});

// ---------------------------------------------------------------------------
// /api/run — flux
// ---------------------------------------------------------------------------

test('GET /api/run succès → flux SSE complet + end "ok"', async () => {
  const { status, frames } = await consumeSSE('/api/run?url=ok', cookieAdmin);
  assert.equal(status, 200);
  assert.ok(frames.length > 0, 'frames SSE attendues');

  assert.equal(frames[0].event, 'meta');

  const phase3Done = frames.find(
    (f) => f.event === 'phase' && f.data.phase === 3 && f.data.progress === 100
  );
  assert.ok(phase3Done, 'phase 3 devrait atteindre 100');

  const end = frames[frames.length - 1];
  assert.equal(end.event, 'end');
  assert.equal(end.data.reason, 'ok');
  assert.equal(end.data.exitCode, 0);
});

test('GET /api/run échec phase 2 → event phase error + end "error"', async () => {
  const { status, frames } = await consumeSSE(
    '/api/run?url=fail-phase-2',
    cookieAdmin
  );
  assert.equal(status, 200);

  const phaseErr = frames.find(
    (f) => f.event === 'phase' && f.data.phase === 2 && f.data.status === 'error'
  );
  assert.ok(phaseErr, 'phase 2 devrait être marquée en erreur');

  const end = frames[frames.length - 1];
  assert.equal(end.event, 'end');
  assert.equal(end.data.reason, 'error');
});

test('GET /api/run abort client → le process doit être tué', async () => {
  const { aborted } = await consumeSSE('/api/run?url=long', cookieAdmin, {
    abortAfterMs: 500,
  });
  assert.ok(aborted, 'on doit avoir aborté');

  await new Promise((r) => setTimeout(r, 600));

  // Un second run doit pouvoir démarrer immédiatement
  const { status } = await consumeSSE('/api/run?url=ok', cookieAdmin, {
    abortAfterMs: 5000,
  });
  assert.equal(status, 200, 'le second run doit être accepté (pas de zombie)');
});