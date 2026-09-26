'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  CACHE_VERSION,
  buildCachePayload,
  writeCache,
  readCache,
  clearCache,
} = require('../../src/cache');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-cache-'));
  return path.join(dir, 'scan.json');
}

function sampleSeries() {
  return {
    onepiece: {
      comics: [
        {
          name: 'comics_a',
          pages: [
            { file: 'comics_a-0001.png', type: 'image', num: 1, ext: 'png' },
            { file: 'comics_a-0002.mp4', type: 'video', num: 2, ext: 'mp4' },
          ],
        },
      ],
      img: [
        {
          name: 'cover_a',
          pages: [
            { file: 'cover_a-0001.png', type: 'image', num: 1, ext: 'png' },
          ],
        },
      ],
    },
  };
}

test('écriture puis lecture → identique', () => {
  const file = tmpFile();
  const payload = buildCachePayload({
    rootDir: '/media',
    series: sampleSeries(),
    now: new Date('2026-09-26T12:00:00.000Z'),
  });

  writeCache(file, payload);
  const read = readCache(file);

  assert.deepEqual(read, payload);
  assert.equal(read.version, CACHE_VERSION);
  assert.equal(read.generatedAt, '2026-09-26T12:00:00.000Z');
  assert.equal(read.rootDir, '/media');
});

test('readCache retourne null si fichier absent', () => {
  assert.equal(readCache('/nonexistent/scan.json'), null);
});

test('readCache retourne null si version mismatch', () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 999, series: {}, generatedAt: 'x', rootDir: '/' })
  );
  assert.equal(readCache(file), null);
});

test('readCache retourne null si cache corrompu (JSON invalide)', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ this is not json');
  assert.equal(readCache(file), null);
});

test('readCache retourne null si structure minimale absente', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ version: CACHE_VERSION }));
  assert.equal(readCache(file), null);

  fs.writeFileSync(
    file,
    JSON.stringify({ version: CACHE_VERSION, series: null })
  );
  assert.equal(readCache(file), null);
});

test('writeCache est atomique : pas de fichier .tmp résiduel', () => {
  const file = tmpFile();
  const dir = path.dirname(file);
  writeCache(
    file,
    buildCachePayload({ rootDir: '/media', series: {} })
  );

  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.equal(leftovers.length, 0);
});

test('writeCache crée le dossier parent si absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-cache-'));
  const nested = path.join(dir, 'a', 'b', 'scan.json');
  writeCache(nested, buildCachePayload({ rootDir: '/', series: {} }));
  assert.ok(fs.existsSync(nested));
});

test('writeCache écrase un cache existant', () => {
  const file = tmpFile();
  writeCache(file, buildCachePayload({ rootDir: '/a', series: { s1: {} } }));
  writeCache(file, buildCachePayload({ rootDir: '/b', series: { s2: {} } }));

  const read = readCache(file);
  assert.equal(read.rootDir, '/b');
  assert.deepEqual(Object.keys(read.series), ['s2']);
});

test('clearCache supprime le fichier', () => {
  const file = tmpFile();
  writeCache(file, buildCachePayload({ rootDir: '/', series: {} }));
  assert.ok(fs.existsSync(file));

  clearCache(file);
  assert.equal(fs.existsSync(file), false);

  // Idempotent : ne throw pas si déjà absent
  assert.doesNotThrow(() => clearCache(file));
});

test('buildCachePayload inclut les champs attendus', () => {
  const p = buildCachePayload({
    rootDir: '/r',
    series: { s: {} },
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  assert.deepEqual(Object.keys(p).sort(), [
    'generatedAt',
    'rootDir',
    'series',
    'version',
  ]);
});