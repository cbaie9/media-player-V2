'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  initProject,
  initProjectSync,
  generateSessionSecret,
} = require('../../scripts/init');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-init-'));
}

// ---------------------------------------------------------------------------
// Sync (utilisé par config.js)
// ---------------------------------------------------------------------------

test('initProjectSync crée .env et config.json', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config', 'config.json');
  const usersPath = path.join(dir, 'config', 'users.json');

  const res = initProjectSync({
    envPath,
    configPath,
    usersPath,
    rootDir: '/tmp/media',
  });

  assert.equal(res.envCreated, true);
  assert.equal(res.configCreated, true);
  assert.equal(res.usersCreated, true);
  assert.ok(fs.existsSync(envPath));
  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.existsSync(usersPath));

  const env = fs.readFileSync(envPath, 'utf8');
  assert.match(env, /SESSION_SECRET=[0-9a-f]{64}/);

  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(cfg.ROOT_DIR, '/tmp/media');
  assert.equal(cfg.PORT, 3000);
  assert.deepEqual(cfg.LOGIN_RATE_LIMIT, {
    windowMinutes: 15,
    maxAttempts: 5,
  });
});

test('initProjectSync ne réécrit pas un fichier existant', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');
  const usersPath = path.join(dir, 'users.json');

  fs.writeFileSync(envPath, 'SESSION_SECRET=deja_la\n');

  const res = initProjectSync({ envPath, configPath, usersPath });

  assert.equal(res.envCreated, false);
  assert.match(fs.readFileSync(envPath, 'utf8'), /deja_la/);
});

test('initProjectSync crée les dossiers parents', () => {
  const dir = tmpDir();
  const configPath = path.join(dir, 'a', 'b', 'c', 'config.json');
  const usersPath = path.join(dir, 'a', 'b', 'c', 'users.json');
  initProjectSync({
    envPath: path.join(dir, '.env'),
    configPath,
    usersPath,
  });
  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.existsSync(usersPath));
});

test('initProjectSync utilise "changeme" par défaut', () => {
  const dir = tmpDir();
  const usersPath = path.join(dir, 'users.json');
  initProjectSync({
    envPath: path.join(dir, '.env'),
    configPath: path.join(dir, 'config.json'),
    usersPath,
  });

  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  assert.ok(users.reader.password_hash);
  assert.ok(users.admin.password_hash);
});

// ---------------------------------------------------------------------------
// Async (utilisé par CLI + npm start)
// ---------------------------------------------------------------------------

test('initProject (async) crée .env et config.json', async () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config', 'config.json');
  const usersPath = path.join(dir, 'config', 'users.json');

  const res = await initProject({
    envPath,
    configPath,
    usersPath,
    rootDir: '/tmp/media',
    readerPassword: 'reader123',
    adminPassword: 'admin123',
    nonInteractive: true,
    silent: true,
  });

  assert.equal(res.envCreated, true);
  assert.equal(res.configCreated, true);
  assert.equal(res.usersCreated, true);
  assert.ok(fs.existsSync(envPath));
  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.existsSync(usersPath));

  const env = fs.readFileSync(envPath, 'utf8');
  assert.match(env, /SESSION_SECRET=[0-9a-f]{64}/);

  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(cfg.ROOT_DIR, '/tmp/media');
});

test('initProject (async) ne réécrit pas un fichier existant', async () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');
  const usersPath = path.join(dir, 'users.json');

  fs.writeFileSync(envPath, 'SESSION_SECRET=deja_la\n');

  const res = await initProject({
    envPath,
    configPath,
    usersPath,
    nonInteractive: true,
    silent: true,
  });

  assert.equal(res.envCreated, false);
  assert.match(fs.readFileSync(envPath, 'utf8'), /deja_la/);
});

test('initProject (async) crée les dossiers parents', async () => {
  const dir = tmpDir();
  const configPath = path.join(dir, 'a', 'b', 'c', 'config.json');
  const usersPath = path.join(dir, 'a', 'b', 'c', 'users.json');

  await initProject({
    envPath: path.join(dir, '.env'),
    configPath,
    usersPath,
    nonInteractive: true,
    silent: true,
  });

  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.existsSync(usersPath));
});

test('initProject (async) écrit les hashs corrects', async () => {
  const dir = tmpDir();
  const usersPath = path.join(dir, 'users.json');

  await initProject({
    envPath: path.join(dir, '.env'),
    configPath: path.join(dir, 'config.json'),
    usersPath,
    readerPassword: 'my_reader_pw',
    adminPassword: 'my_admin_pw',
    nonInteractive: true,
    silent: true,
  });

  const bcrypt = require('bcrypt');
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  assert.equal(
    await bcrypt.compare('my_reader_pw', users.reader.password_hash),
    true
  );
  assert.equal(
    await bcrypt.compare('my_admin_pw', users.admin.password_hash),
    true
  );
  assert.equal(
    await bcrypt.compare('my_reader_pw', users.admin.password_hash),
    false
  );
});

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

test('generateSessionSecret retourne 64 hex', () => {
  const s = generateSessionSecret();
  assert.match(s, /^[0-9a-f]{64}$/);
});