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
  writeWarningsLog,
  REASONS,
  EXT_PRIORITY,
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
  const comics = scanFolder(dir, 'test/comics', warnings);

  assert.equal(comics.length, 1);
  assert.equal(comics[0].pages.length, 1);
  assert.equal(comics[0].pages[0].ext, 'png');
  assert.equal(comics[0].pages[0].type, 'image');
});

test('A3 : .gif gagne sur .png (alpha strict côté image)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');
  fs.writeFileSync(path.join(dir, 'x-0001.gif'), 'gif');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics[0].pages[0].ext, 'gif');
});

test('A3 : .mp4 gagne sur .webm (alpha strict côté video)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.webm'), 'webm');
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'mp4');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics[0].pages[0].ext, 'mp4');
});

test('A3 : trois doublons → gif gagne', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'mp4');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');
  fs.writeFileSync(path.join(dir, 'x-0001.gif'), 'gif');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics[0].pages[0].ext, 'gif');
});

test('A3 : le doublon écarté est loggé', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a3-'));
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'mp4');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');

  const warnings = [];
  scanFolder(dir, 'test/comics', warnings);

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

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].name, 'comics_a');
  assert.equal(comics[0].pages[0].ext, 'png');
  assert.equal(comics[0].pages[0].file, 'comics_a-0001.png');
});

test('A4 : doublon avec casses différentes → un seul comics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a4-'));
  fs.writeFileSync(path.join(dir, 'Comics_A-0001.PNG'), 'x');
  fs.writeFileSync(path.join(dir, 'comics_a-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].pages.length, 1);
});

test('A4 : le chemin de warning est lowercase', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a4-'));
  fs.writeFileSync(path.join(dir, 'COVER.PNG'), 'x');

  const warnings = [];
  scanFolder(dir, 'test/comics', warnings);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].relPath, /cover\.png$/);
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
  const comics = scanFolder(dir, 'test/comics', warnings);

  assert.equal(comics.length, 1);
  assert.equal(comics[0].name, 'real');
  assert.equal(warnings.length, 0);
});

test('A5 : symlink vers dossier ignoré sans warning dossier_ignore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a5-'));
  const subdir = path.join(dir, 'sub');
  fs.mkdirSync(subdir);

  try {
    fs.symlinkSync(subdir, path.join(dir, 'link_dir'), 'dir');
  } catch (err) {
    if (err.code === 'EPERM') return;
    throw err;
  }

  const warnings = [];
  scanFolder(dir, 'test/comics', warnings);

  const linkWarn = warnings.find((w) => w.relPath.includes('link_dir'));
  assert.equal(linkWarn, undefined);
});

test('A5 : symlink cassé ignoré sans warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-a5-'));

  try {
    fs.symlinkSync('/nonexistent/target', path.join(dir, 'broken-0001.png'));
  } catch (err) {
    if (err.code === 'EPERM') return;
    throw err;
  }

  const warnings = [];
  scanFolder(dir, 'test/comics', warnings);
  assert.equal(warnings.length, 0);
});

// ---------------------------------------------------------------------------
// V1.1 — B15 : hasVideo par page et par comics
// ---------------------------------------------------------------------------

test('V1.1 : hasVideo=false par page image', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-hv-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics[0].pages[0].hasVideo, false);
});

test('V1.1 : hasVideo=true par page vidéo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-hv-'));
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'x');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics[0].pages[0].hasVideo, true);
});

test('V1.1 : hasVideo=false au niveau comics si 100% image', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-hv-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');
  fs.writeFileSync(path.join(dir, 'x-0002.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics[0].hasVideo, false);
  assert.equal(comics[0].pages.every((p) => p.hasVideo === false), true);
});

test('V1.1 : hasVideo=true au niveau comics si au moins une vidéo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv2-hv-'));
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');
  fs.writeFileSync(path.join(dir, 'x-0002.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'x-0003.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', []);
  assert.equal(comics[0].hasVideo, true);
  assert.equal(comics[0].pages[0].hasVideo, false);
  assert.equal(comics[0].pages[1].hasVideo, true);
  assert.equal(comics[0].pages[2].hasVideo, false);
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

test('comics_b a hasVideo=false (image uniquement)', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  const cb = series.serie_a.comics.find((c) => c.name === 'comics_b');
  assert.equal(cb.hasVideo, false);
});

test('fixtures : dup-0001.png vs dup-0001.mp4 → .png gagne (A3)', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  const dup = series.serie_a.comics.find((c) => c.name === 'dup');
  assert.equal(dup.pages.length, 1);
  assert.equal(dup.pages[0].ext, 'png');
});

test('stats cohérents', () => {
  const { stats, series } = scanRoot({ rootDir: ROOT });

  assert.equal(stats.seriesCount, 2);

  const serieA = series.serie_a;
  const serieB = series.serie_b;

  assert.equal(serieA.comics.length, 3);
  assert.equal(serieA.img.length, 1);
  assert.equal(serieB.comics.length, 1);
  assert.equal(serieB.img.length, 0);

  assert.equal(stats.comicsCount, 5);
});

test('stats : total pages = 7', () => {
  const { series } = scanRoot({ rootDir: ROOT });
  let totalPages = 0;
  for (const s of Object.values(series)) {
    for (const c of s.comics) totalPages += c.pages.length;
    for (const c of s.img) totalPages += c.pages.length;
  }
  assert.equal(totalPages, 7);
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