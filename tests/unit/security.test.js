'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  safeResolve,
  parseSafeSegments,
  matchesPattern,
  LoginRateLimiter,
} = require('../../src/security');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sec-'));
}

test('safeResolve accepte un chemin valide sous la racine', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'serie_a', 'comics'), { recursive: true });
  const f = path.join(root, 'serie_a', 'comics', 'x-0001.png');
  fs.writeFileSync(f, 'x');

  const resolved = safeResolve(root, 'serie_a/comics/x-0001.png');
  assert.ok(resolved);
  assert.equal(resolved, fs.realpathSync(f));
});

test('safeResolve rejette ../../', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'sub'));
  const resolved = safeResolve(root, '../../etc/passwd');
  assert.equal(resolved, null);
});

test('safeResolve rejette un chemin absolu hors racine', () => {
  const root = tmpDir();
  const resolved = safeResolve(root, '/etc/passwd');
  assert.equal(resolved, null);
});

test('safeResolve rejette les null bytes', () => {
  const root = tmpDir();
  assert.equal(safeResolve(root, 'foo\0bar'), null);
});

test('safeResolve rejette un symlink sortant (R3)', () => {
  const root = tmpDir();
  const outside = tmpDir();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');

  try {
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  } catch (err) {
    // Sur Windows sans privilège admin, on skip
    if (err.code === 'EPERM') return;
    throw err;
  }

  const resolved = safeResolve(root, 'link.txt');
  assert.equal(resolved, null);
});

test('safeResolve accepte un symlink interne à la racine', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'real'));
  fs.writeFileSync(path.join(root, 'real', 'a.png'), 'a');

  try {
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'));
  } catch (err) {
    if (err.code === 'EPERM') return;
    throw err;
  }

  const resolved = safeResolve(root, 'link/a.png');
  assert.ok(resolved);
});

test('safeResolve accepte la racine elle-même', () => {
  const root = tmpDir();
  const resolved = safeResolve(root, '.');
  assert.ok(resolved);
  assert.equal(resolved, fs.realpathSync(root));
});

test('parseSafeSegments accepte un segment simple', () => {
  assert.deepEqual(parseSafeSegments('onepiece'), ['onepiece']);
});

test('parseSafeSegments rejette les séparateurs', () => {
  assert.equal(parseSafeSegments('a/b'), null);
  assert.equal(parseSafeSegments('a\\b'), null);
});

test('parseSafeSegments rejette .. et .', () => {
  assert.equal(parseSafeSegments('..'), null);
  assert.equal(parseSafeSegments('.'), null);
});

test('matchesPattern respecte la regex', () => {
  const re = /^[a-z0-9_-]+$/;
  assert.equal(matchesPattern('onepiece', re), true);
  assert.equal(matchesPattern('one piece', re), false);
  assert.equal(matchesPattern('OnePiece', re), false);
});

// --- Rate limiter ---------------------------------------------------------

test('LoginRateLimiter autorise 5 tentatives', () => {
  let t = 0;
  const rl = new LoginRateLimiter({ now: () => t });
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.register('1.2.3.4').allowed, true);
  }
  const r = rl.register('1.2.3.4');
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSeconds > 0);
});

test('LoginRateLimiter reset au succès', () => {
  const rl = new LoginRateLimiter();
  rl.register('ip');
  rl.register('ip');
  rl.reset('ip');
  assert.equal(rl.peek('ip').remaining, 5);
});

test('LoginRateLimiter fenêtre expirée → reset auto', () => {
  let t = 0;
  const rl = new LoginRateLimiter({ now: () => t, windowMs: 1000, maxAttempts: 2 });
  rl.register('ip');
  rl.register('ip');
  assert.equal(rl.register('ip').allowed, false);

  t = 2000; // fenêtre dépassée
  assert.equal(rl.register('ip').allowed, true);
});

test('LoginRateLimiter isole les clés', () => {
  const rl = new LoginRateLimiter({ maxAttempts: 1 });
  assert.equal(rl.register('a').allowed, true);
  assert.equal(rl.register('a').allowed, false);
  assert.equal(rl.register('b').allowed, true);
});

test('LoginRateLimiter cleanup purge les expirés', () => {
  let t = 0;
  const rl = new LoginRateLimiter({ now: () => t, windowMs: 1000 });
  rl.register('a');
  rl.register('b');
  t = 2000;
  rl.cleanup();
  assert.equal(rl.buckets.size, 0);
});