'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { makeFixtures } = require('../../scripts/make-fixtures');
const {
  scanRoot,
  scanFolder,
  scanSerieFolders,
  writeWarningsLog,
  REASONS,
  EXT_PRIORITY,
  FOLDER_COMICS,
  FOLDER_COMICS_ADMIN,
  FOLDER_IMG,
  FOLDER_IMG_ADMIN,
  ALL_FOLDERS,
  isAdminFolder,
  baseFolder,
} = require('../../src/scanner');

let ROOT;

before(() => {
  ROOT = makeFixtures({ withDuplicates: true });
});

// ---------------------------------------------------------------------------
// A3 — Ordre de priorité
// ---------------------------------------------------------------------------

test('A3 : EXT_PRIORITY respecte "image puis video, alpha strict"', () => {
  assert.deepEqual(EXT_PRIORITY, [
    'gif', 'jpeg', 'jpg', 'png', 'webp', 'mp4', 'webm',
  ]);
});

test('A3 : .png gagne sur .mp4 (image prioritaire)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'video');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'image');

  const warnings = [];
  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(comics.length, 1);
  assert.equal(comics[0].pages.length, 1);
  assert.equal(comics[0].pages[0].ext, 'png');
  assert.equal(comics[0].pages[0].type, 'image');
});

test('A3 : .gif gagne sur .png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');
  fs.writeFileSync(path.join(dir, 'x-0001.gif'), 'gif');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].pages[0].ext, 'gif');
});

test('A3 : .mp4 gagne sur .webm', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.webm'), 'webm');
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'mp4');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].pages[0].ext, 'mp4');
});

test('A3 : le doublon écarté est loggé', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'mp4');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');

  const warnings = [];
  scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, REASONS.NUMERO_INVALIDE);
  assert.match(warnings[0].note, /\.png/);
});

// ---------------------------------------------------------------------------
// A4 — Normalisation lowercase
// ---------------------------------------------------------------------------

test('A4 : extension majuscule normalisée', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a4-'));
  fs.writeFileSync(path.join(dir, 'Comics_A-0001.PNG'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].name, 'comics_a');
  assert.equal(comics[0].pages[0].ext, 'png');
  assert.equal(comics[0].pages[0].file, 'comics_a-0001.png');
});

test('A4 : doublon avec casses différentes → un seul comics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a4-'));
  fs.writeFileSync(path.join(dir, 'Comics_A-0001.PNG'), 'x');
  fs.writeFileSync(path.join(dir, 'comics_a-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].pages.length, 1);
});

// ---------------------------------------------------------------------------
// A5 — Symlinks ignorés sans warning
// ---------------------------------------------------------------------------

test('A5 : symlink vers fichier ignoré sans warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a5-'));
  const target = path.join(dir, 'real-0001.png');
  fs.writeFileSync(target, 'x');

  try {
    fs.symlinkSync(target, path.join(dir, 'link-0001.png'));
  } catch (err) {
    if (err.code === 'EPERM') return;
    throw err;
  }

  const warnings = [];
  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(comics.length, 1);
  assert.equal(comics[0].name, 'real');
  assert.equal(warnings.length, 0);
});

// ---------------------------------------------------------------------------
// V1.1 — B15 : hasVideo
// ---------------------------------------------------------------------------

test('V1.1 : hasVideo=false par page image', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-hv-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].pages[0].hasVideo, false);
});

test('V1.1 : hasVideo=true au niveau comics si au moins une vidéo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-hv-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');
  fs.writeFileSync(path.join(dir, 'x-0002.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'x-0003.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].hasVideo, true);
  assert.equal(comics[0].pages[0].hasVideo, false);
  assert.equal(comics[0].pages[1].hasVideo, true);
  assert.equal(comics[0].pages[2].hasVideo, false);
});

// ---------------------------------------------------------------------------
// V1.2 — Constantes folders
// ---------------------------------------------------------------------------

test('V1.2 : ALL_FOLDERS contient les 4 dossiers attendus', () => {
  assert.deepEqual(ALL_FOLDERS, [
    'comics',
    'comics_admin',
    'img',
    'img_admin',
  ]);
});

test('V1.2 : isAdminFolder', () => {
  assert.equal(isAdminFolder('comics'), false);
  assert.equal(isAdminFolder('img'), false);
  assert.equal(isAdminFolder('comics_admin'), true);
  assert.equal(isAdminFolder('img_admin'), true);
});

test('V1.2 : baseFolder', () => {
  assert.equal(baseFolder('comics'), 'comics');
  assert.equal(baseFolder('comics_admin'), 'comics');
  assert.equal(baseFolder('img'), 'img');
  assert.equal(baseFolder('img_admin'), 'img');
});

// ---------------------------------------------------------------------------
// V1.2 — scanFolder : folder + adminOnly sur chaque comics
// ---------------------------------------------------------------------------

test('V1.2 : scanFolder comics → folder=comics, adminOnly=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-fold-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].folder, 'comics');
  assert.equal(comics[0].adminOnly, false);
});

test('V1.2 : scanFolder comics_admin → folder=comics_admin, adminOnly=true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-fold-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(
    dir,
    'test/comics_admin',
    FOLDER_COMICS_ADMIN,
    []
  );
  assert.equal(comics[0].folder, 'comics_admin');
  assert.equal(comics[0].adminOnly, true);
});

test('V1.2 : scanFolder img_admin → folder=img_admin, adminOnly=true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-fold-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/img_admin', FOLDER_IMG_ADMIN, []);
  assert.equal(comics[0].folder, 'img_admin');
  assert.equal(comics[0].adminOnly, true);
});

// ---------------------------------------------------------------------------
// V1.2 — scanSerieFolders : fusion comics + comics_admin
// ---------------------------------------------------------------------------

test('V1.2 : scanSerieFolders fusionne comics + comics_admin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sf-'));
  fs.mkdirSync(path.join(dir, 'comics'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'comics_admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'comics', 'a-0001.png'), 'x');
  fs.writeFileSync(path.join(dir, 'comics_admin', 'a-0001.png'), 'x');

  const { comics, img } = scanSerieFolders(dir, 'test', []);

  assert.equal(comics.length, 2);
  assert.equal(img.length, 0);

  const normal = comics.find((c) => c.folder === 'comics');
  const admin = comics.find((c) => c.folder === 'comics_admin');
  assert.ok(normal);
  assert.ok(admin);
  assert.equal(normal.name, 'a');
  assert.equal(admin.name, 'a');
});

test('V1.2 : scanSerieFolders trie admin après normal à nom égal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sf-'));
  fs.mkdirSync(path.join(dir, 'comics'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'comics_admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'comics', 'a-0001.png'), 'x');
  fs.writeFileSync(path.join(dir, 'comics_admin', 'a-0001.png'), 'x');

  const { comics } = scanSerieFolders(dir, 'test', []);
  assert.equal(comics[0].folder, 'comics');
  assert.equal(comics[1].folder, 'comics_admin');
});

test('V1.2 : scanSerieFolders avec seulement comics_admin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sf-'));
  fs.mkdirSync(path.join(dir, 'comics_admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'comics_admin', 'a-0001.png'), 'x');

  const { comics, img } = scanSerieFolders(dir, 'test', []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].folder, 'comics_admin');
  assert.equal(comics[0].adminOnly, true);
  assert.equal(img.length, 0);
});

test('V1.2 : scanSerieFolders avec img_admin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sf-'));
  fs.mkdirSync(path.join(dir, 'img_admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'img_admin', 'c-0001.png'), 'x');

  const { comics, img } = scanSerieFolders(dir, 'test', []);
  assert.equal(comics.length, 0);
  assert.equal(img.length, 1);
  assert.equal(img[0].folder, 'img_admin');
  assert.equal(img[0].adminOnly, true);
});

// ---------------------------------------------------------------------------
// V1.2 — scanRoot : adminOnly dérivé sur la série
// ---------------------------------------------------------------------------

test('V1.2 : série avec comics normal → adminOnly=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sr-'));
  fs.mkdirSync(path.join(dir, 'onepiece', 'comics'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'comics', 'a-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.adminOnly, false);
});

test('V1.2 : série avec uniquement comics_admin → adminOnly=true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sr-'));
  fs.mkdirSync(path.join(dir, 'onepiece', 'comics_admin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'comics_admin', 'a-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.adminOnly, true);
});

test('V1.2 : série avec comics_admin + img normal → adminOnly=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sr-'));
  fs.mkdirSync(path.join(dir, 'onepiece', 'comics_admin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'onepiece', 'img'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'comics_admin', 'a-0001.png'),
    'x'
  );
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'img', 'b-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.adminOnly, false);
});

test('V1.2 : série avec uniquement img_admin → adminOnly=true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-sr-'));
  fs.mkdirSync(path.join(dir, 'onepiece', 'img_admin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'img_admin', 'a-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.adminOnly, true);
});

// ---------------------------------------------------------------------------
// Tests existants (rappelés)
// ---------------------------------------------------------------------------

test('scanRoot découvre les 2 séries', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  assert.deepEqual(Object.keys(series).sort(), ['serie_a', 'serie_b']);
});

test('scanRoot parse comics + img pour serie_a', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  const a = series.serie_a;
  assert.deepEqual(
    a.comics.map((c) => c.name).sort(),
    ['comics_a', 'comics_b', 'dup']
  );
  assert.deepEqual(a.img.map((c) => c.name), ['cover_a']);
});

test('comics_a contient 3 pages triées', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  const ca = series.serie_a.comics.find((c) => c.name === 'comics_a');
  assert.equal(ca.pages.length, 3);
  assert.deepEqual(ca.pages.map((p) => p.num), [1, 2, 3]);
});

test('comics_a a hasVideo=true (contient comics_a-0003.mp4)', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  const ca = series.serie_a.comics.find((c) => c.name === 'comics_a');
  assert.equal(ca.hasVideo, true);
});

test('fixtures : dup-0001.png vs dup-0001.mp4 → .png gagne (A3)', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  const dup = series.serie_a.comics.find((c) => c.name === 'dup');
  assert.equal(dup.pages.length, 1);
  assert.equal(dup.pages[0].ext, 'png');
});

test('scanRoot sur dossier inexistant → error', () => {
  const res = scanRoot({ rootDir: '/nonexistent/xyz' });
  assert.equal(res.error, 'root_dir_unavailable');
});

test('writeWarningsLog écrit et écrase', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-warn-'));
  const file = path.join(dir, 'scan-warnings.log');
  writeWarningsLog(file, [
    { relPath: 'a.png', reason: REASONS.NOM_NON_CONFORME },
  ]);
  writeWarningsLog(file, [
    { relPath: 'b.png', reason: REASONS.EXTENSION_NON_SUPPORTE },
  ]);
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(!content.includes('a.png'));
  assert.match(content, /b\.png/);
});