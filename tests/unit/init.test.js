'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { initProject, generateSessionSecret } = require('../../scripts/init');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-init-'));
}

test('generateSessionSecret retourne 64 hex', () => {
  const s = generateSessionSecret();
  assert.match(s, /^[0-9a-f]{64}$/);
});

test('initProject crée .env et config.json', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config', 'config.json');

  const res = initProject({ envPath, configPath, rootDir: '/tmp/media' });
  assert.equal(res.envCreated, true);
  assert.equal(res.configCreated, true);
  assert.ok(fs.existsSync(envPath));
  assert.ok(fs.existsSync(configPath));

  const env = fs.readFileSync(envPath, 'utf8');
  assert.match(env, /SESSION_SECRET=[0-9a-f]{64}/);

  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(cfg.ROOT_DIR, '/tmp/media');
  assert.equal(cfg.PORT, 3000);
  assert.deepEqual(cfg.LOGIN_RATE_LIMIT, { windowMinutes: 15, maxAttempts: 5 });
});

test('initProject ne réécrit pas un fichier existant', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, 'SESSION_SECRET=deja_la\n');

  const res = initProject({ envPath, configPath: path.join(dir, 'config.json') });
  assert.equal(res.envCreated, false);
  assert.match(fs.readFileSync(envPath, 'utf8'), /deja_la/);
});

test('initProject crée les dossiers parents', () => {
  const dir = tmpDir();
  const configPath = path.join(dir, 'a', 'b', 'c', 'config.json');
  initProject({ envPath: path.join(dir, '.env'), configPath });
  assert.ok(fs.existsSync(configPath));
});