'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadConfig } = require('../../src/config');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-config-'));
}

beforeEach(() => {
  // Isole chaque test : évite les fuites via process.env
  delete process.env.SESSION_SECRET;
  delete process.env.PORT;
});

test('loadConfig génère les fichiers si absents (G3)', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');

  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const { generated, sessionSecret } = loadConfig({ envPath, configPath });
    assert.equal(generated.env, true);
    assert.equal(generated.config, true);
    assert.match(sessionSecret, /^[0-9a-f]{64}$/);
  } finally {
    console.warn = origWarn;
  }
});

test('loadConfig fusionne les défauts et le fichier', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');

  fs.writeFileSync(envPath, 'SESSION_SECRET=' + 'a'.repeat(64) + '\n');
  fs.writeFileSync(
    configPath,
    JSON.stringify({ ROOT_DIR: '/custom', PORT: 8080 })
  );

  const { config, sessionSecret } = loadConfig({ envPath, configPath });
  assert.equal(config.ROOT_DIR, '/custom');
  assert.equal(config.PORT, 8080);
  assert.equal(config.HTTPS, false); // défaut conservé
  assert.equal(sessionSecret, 'a'.repeat(64));
});

test('loadConfig lève une erreur si SESSION_SECRET manquant', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');

  fs.writeFileSync(envPath, '# vide\n');
  fs.writeFileSync(configPath, JSON.stringify({}));

  assert.throws(() => loadConfig({ envPath, configPath }), /SESSION_SECRET/);
});

test('loadConfig respecte PORT depuis process.env si .env ne le définit pas', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');

  fs.writeFileSync(envPath, 'SESSION_SECRET=' + 'b'.repeat(64) + '\n');
  fs.writeFileSync(configPath, JSON.stringify({ PORT: 3000 }));

  process.env.PORT = '9999';
  try {
    const { config } = loadConfig({ envPath, configPath });
    assert.equal(config.PORT, 9999);
  } finally {
    delete process.env.PORT;
  }
});

test('loadConfig : .env prioritaire sur process.env pour PORT', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');

  fs.writeFileSync(
    envPath,
    `SESSION_SECRET=${'c'.repeat(64)}\nPORT=7000\n`
  );
  fs.writeFileSync(configPath, JSON.stringify({ PORT: 3000 }));

  process.env.PORT = '9999';
  try {
    const { config } = loadConfig({ envPath, configPath });
    assert.equal(config.PORT, 7000, '.env doit gagner sur process.env');
  } finally {
    delete process.env.PORT;
  }
});