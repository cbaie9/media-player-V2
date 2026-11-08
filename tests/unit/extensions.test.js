'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  EXTENSIONS,
  VALID_EXTENSIONS,
  EXT_PRIORITY,
  MIME_TYPES,
  TYPE_BY_EXT,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  EXT_ALTERNATION,
  SUPPORTED_EXT_RE,
  mimeGroups,
} = require('../../src/utils/extensions');

const {
  parseFilename,
  typeFromExt,
  FILENAME_REGEX,
} = require('../../src/utils/parseFilename');

const { mimeFromExt } = require('../../src/utils/mime');

const {
  EXT_PRIORITY: SCANNER_EXT_PRIORITY,
} = require('../../src/scanner');

// ---------------------------------------------------------------------------
// 1. Cohérence interne de extensions.js
// ---------------------------------------------------------------------------

test('EXTENSIONS : liste non vide, ordre alpha strict (A3)', () => {
  assert.ok(EXTENSIONS.length > 0);
  // Vérifie que l'ordre est : images (alpha) puis vidéos (alpha)
  const images = EXTENSIONS.filter((e) => e.type === 'image');
  const videos = EXTENSIONS.filter((e) => e.type === 'video');

  // Toutes les images viennent avant les vidéos
  const lastImageIdx = EXTENSIONS.findIndex(
    (e) => e === images[images.length - 1]
  );
  const firstVideoIdx = EXTENSIONS.findIndex((e) => e === videos[0]);
  if (videos.length > 0) {
    assert.ok(lastImageIdx < firstVideoIdx, 'images doivent précéder vidéos');
  }

  // Images en ordre alpha
  const imageExts = images.map((e) => e.ext);
  assert.deepEqual(imageExts, [...imageExts].sort());

  // Vidéos en ordre alpha
  const videoExts = videos.map((e) => e.ext);
  assert.deepEqual(videoExts, [...videoExts].sort());
});

test('EXTENSIONS : pas de doublon', () => {
  const set = new Set(VALID_EXTENSIONS);
  assert.equal(set.size, VALID_EXTENSIONS.length);
});

test('EXTENSIONS : chaque entrée a ext + type + mime', () => {
  for (const e of EXTENSIONS) {
    assert.equal(typeof e.ext, 'string');
    assert.ok(['image', 'video'].includes(e.type));
    assert.match(e.mime, /^(image|video)\//);
  }
});

// ---------------------------------------------------------------------------
// 2. Propagation cohérente dans les dérivés
// ---------------------------------------------------------------------------

test('VALID_EXTENSIONS === EXT_PRIORITY (même array)', () => {
  assert.equal(VALID_EXTENSIONS, EXT_PRIORITY);
});

test('scanner.EXT_PRIORITY === extensions.EXT_PRIORITY (même array)', () => {
  assert.equal(SCANNER_EXT_PRIORITY, EXT_PRIORITY);
});

test('MIME_TYPES couvre exactement VALID_EXTENSIONS', () => {
  assert.deepEqual(
    Object.keys(MIME_TYPES).sort(),
    [...VALID_EXTENSIONS].sort()
  );
});

test('TYPE_BY_EXT couvre exactement VALID_EXTENSIONS', () => {
  assert.deepEqual(
    Object.keys(TYPE_BY_EXT).sort(),
    [...VALID_EXTENSIONS].sort()
  );
});

test('IMAGE_EXTENSIONS + VIDEO_EXTENSIONS = VALID_EXTENSIONS', () => {
  assert.equal(
    IMAGE_EXTENSIONS.length + VIDEO_EXTENSIONS.length,
    VALID_EXTENSIONS.length
  );
});

// ---------------------------------------------------------------------------
// 3. Cohérence regex
// ---------------------------------------------------------------------------

test('FILENAME_REGEX matche TOUTES les extensions valides', () => {
  for (const ext of VALID_EXTENSIONS) {
    const name = `comics_a-0001.${ext}`;
    const m = FILENAME_REGEX.exec(name);
    assert.ok(m, `FILENAME_REGEX doit matcher ${name}`);
    assert.equal(m.groups.ext, ext);
  }
});

test('SUPPORTED_EXT_RE matche TOUTES les extensions valides', () => {
  for (const ext of VALID_EXTENSIONS) {
    assert.ok(
      SUPPORTED_EXT_RE.test(`x-0001.${ext}`),
      `SUPPORTED_EXT_RE doit matcher .${ext}`
    );
  }
});

test('SUPPORTED_EXT_RE rejette les extensions inconnues', () => {
  for (const bad of ['heic', 'jp2', 'tiff', 'bmp', 'txt', 'jxl.bak']) {
    assert.equal(
      SUPPORTED_EXT_RE.test(`x-0001.${bad}`),
      false,
      `SUPPORTED_EXT_RE ne doit PAS matcher .${bad}`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Cohérence des helpers publics
// ---------------------------------------------------------------------------

test('parseFilename + mimeFromExt + typeFromExt cohérents pour chaque ext', () => {
  for (const { ext, type, mime } of EXTENSIONS) {
    const parsed = parseFilename(`x-0001.${ext}`);
    assert.ok(parsed, `parseFilename doit accepter .${ext}`);
    assert.equal(parsed.ext, ext);

    assert.equal(
      typeFromExt(ext),
      type,
      `typeFromExt('${ext}') === '${type}'`
    );
    assert.equal(
      mimeFromExt(ext),
      mime,
      `mimeFromExt('${ext}') === '${mime}'`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. mimeGroups()
// ---------------------------------------------------------------------------

test('mimeGroups() regroupe correctement (jpeg + jpg sur image/jpeg)', () => {
  const groups = mimeGroups();
  assert.deepEqual(groups['image/jpeg'], ['jpeg', 'jpg']);
  assert.deepEqual(groups['image/jxl'], ['jxl']);
  assert.deepEqual(groups['image/avif'], ['avif']);
  assert.deepEqual(groups['video/mp4'], ['mp4']);
  assert.deepEqual(groups['video/webm'], ['webm']);
});