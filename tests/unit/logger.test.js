'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Logger, readLog } = require('../../src/logger');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-log-'));
  return path.join(dir, 'app.jsonl');
}

const FIXED_DATE = new Date('2026-09-26T12:00:00.000Z');

test('Logger crée le dossier parent si absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-log-'));
  const nested = path.join(dir, 'a', 'b', 'app.jsonl');
  const logger = new Logger({ filePath: nested });
  logger.info('test_event');
  assert.ok(fs.existsSync(nested));
});

test('Logger écrit une ligne JSON par événement', () => {
  const file = tmpFile();
  const logger = new Logger({ filePath: file, now: () => FIXED_DATE });

  logger.info('server_start', { port: 3000, rootDir: '/media', cacheLoaded: true });
  logger.warn('login_failure', { username: 'bob', ip: '10.0.0.1' });
  logger.error('error', { message: 'boom' });

  const entries = readLog(file);
  assert.equal(entries.length, 3);

  assert.deepEqual(entries[0], {
    ts: '2026-09-26T12:00:00.000Z',
    level: 'info',
    event: 'server_start',
    port: 3000,
    rootDir: '/media',
    cacheLoaded: true,
  });
  assert.equal(entries[1].level, 'warn');
  assert.equal(entries[1].event, 'login_failure');
  assert.equal(entries[2].level, 'error');
});

test('Logger ajoute en fin de fichier (append)', () => {
  const file = tmpFile();
  const logger = new Logger({ filePath: file, now: () => FIXED_DATE });

  logger.info('a');
  logger.info('b');

  const entries = readLog(file);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'a');
  assert.equal(entries[1].event, 'b');
});

test('Logger accepte champs vides', () => {
  const file = tmpFile();
  const logger = new Logger({ filePath: file, now: () => FIXED_DATE });
  logger.info('simple');
  const [entry] = readLog(file);
  assert.equal(entry.event, 'simple');
  assert.equal(entry.level, 'info');
  assert.equal(entry.ts, '2026-09-26T12:00:00.000Z');
});

test('Logger downgrade un niveau invalide en warn', () => {
  const file = tmpFile();
  const logger = new Logger({ filePath: file, now: () => FIXED_DATE });
  logger.log('debug', 'oops');
  const [entry] = readLog(file);
  assert.equal(entry.level, 'warn');
  assert.equal(entry._invalidLevel, 'debug');
});

test('Logger ne throw pas si JSON.stringify échoue', () => {
  const file = tmpFile();
  const fakeStderr = { write: () => {} };
  const logger = new Logger({ filePath: file, now: () => FIXED_DATE, stderr: fakeStderr });

  const circular = {};
  circular.self = circular;

  assert.doesNotThrow(() => logger.info('bad', { circular }));
  // Le fichier a été créé mais vide (pas d'entrée)
  assert.equal(readLog(file).length, 0);
});

test('readLog retourne [] pour fichier absent', () => {
  assert.deepEqual(readLog('/nonexistent/app.jsonl'), []);
});

test('readLog ignore les lignes corrompues', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"ts":"x","level":"info","event":"ok"}\nnot json\n\n');
  const entries = readLog(file);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'ok');
});

test('Logger rejette un filePath manquant', () => {
  assert.throws(() => new Logger({}), /filePath/);
  assert.throws(() => new Logger(), /filePath/);
});