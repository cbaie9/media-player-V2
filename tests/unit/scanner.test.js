'use strict';

const { test, before, after } = require('node:test');
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

const onWindows = process.platform === 'win32';

// V1.5.3 — Politique fixtures :
//   - Comics (images/vidéos) : tests/fixtures/scanner/<name>/
//   - Logs                    : os.tmpdir() (avec cleanup après la suite)
//
// Chaque sous-dossier de tests/fixtures/scanner/ est isolé par test,
// et l'ensemble est nettoyé en after(). ROOT (root_tests) reste géré
// par makeFixtures().
const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');
const SCANNER_FIXTURES_ROOT = path.join(FIXTURES_ROOT, 'scanner');

/** Dirs temporaires (logs) à nettoyer dans after() */
const tempDirs = [];

/**
 * Crée un sous-dossier isolé sous tests/fixtures/scanner/.
 * Réservé aux COMICS (images, vidéos, sous-dossiers de série).
 * @param {string} name
 * @returns {string} chemin absolu
 */
function makeComicsDir(name) {
  const dir = path.join(SCANNER_FIXTURES_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Crée un sous-dossier temporaire pour les logs.
 * Réservé aux fichiers de log (pas des comics).
 * @param {string} prefix
 * @returns {string} chemin absolu
 */
function makeLogDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let ROOT;

before(() => {
  // Wipe + recrée tests/fixtures/scanner/ pour isolation entre runs
  fs.rmSync(SCANNER_FIXTURES_ROOT, { recursive: true, force: true });
  fs.mkdirSync(SCANNER_FIXTURES_ROOT, { recursive: true });
  ROOT = makeFixtures({ withDuplicates: true });
});

after(() => {
  // Cleanup global : comics (fixtures/scanner/) + logs (temp)
  fs.rmSync(SCANNER_FIXTURES_ROOT, { recursive: true, force: true });
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A3 — Ordre de priorité
// ---------------------------------------------------------------------------

test('A3 : EXT_PRIORITY respecte "image puis video, alpha strict"', () => {
  assert.deepEqual(EXT_PRIORITY, [
    'avif', 'gif', 'jpeg', 'jpg', 'jxl', 'png', 'webp', 'mp4', 'webm',
  ]);
});

test('A3 : .png gagne sur .mp4 (image prioritaire)', () => {
  const dir = makeComicsDir('a3-png-vs-mp4');
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
  const dir = makeComicsDir('a3-gif-vs-png');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');
  fs.writeFileSync(path.join(dir, 'x-0001.gif'), 'gif');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].pages[0].ext, 'gif');
});

test('A3 : .mp4 gagne sur .webm', () => {
  const dir = makeComicsDir('a3-mp4-vs-webm');
  fs.writeFileSync(path.join(dir, 'x-0001.webm'), 'webm');
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'mp4');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].pages[0].ext, 'mp4');
});

test('A3 : le doublon écarté est loggé', () => {
  const dir = makeComicsDir('a3-doublon-logged');
  fs.writeFileSync(path.join(dir, 'x-0001.mp4'), 'mp4');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');

  const warnings = [];
  scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, REASONS.NUMERO_INVALIDE);
  assert.match(warnings[0].note, /\.png/);
});

// ---------------------------------------------------------------------------
// V1.5.2 — Formats image modernes : .jxl et .avif
// ---------------------------------------------------------------------------

test('V1.5.2 : .jxl accepté comme image', () => {
  const dir = makeComicsDir('v152-jxl');
  fs.writeFileSync(path.join(dir, 'x-0001.jxl'), 'jxl');

  const warnings = [];
  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(comics.length, 1);
  assert.equal(comics[0].name, 'x');
  assert.equal(comics[0].pages.length, 1);
  assert.equal(comics[0].pages[0].ext, 'jxl');
  assert.equal(comics[0].pages[0].type, 'image');
  assert.equal(comics[0].pages[0].hasVideo, false);
  assert.equal(comics[0].hasVideo, false);
  assert.equal(warnings.length, 0);
});

test('V1.5.2 : .avif accepté comme image', () => {
  const dir = makeComicsDir('v152-avif');
  fs.writeFileSync(path.join(dir, 'x-0001.avif'), 'avif');

  const warnings = [];
  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(comics.length, 1);
  assert.equal(comics[0].pages.length, 1);
  assert.equal(comics[0].pages[0].ext, 'avif');
  assert.equal(comics[0].pages[0].type, 'image');
  assert.equal(warnings.length, 0);
});

test('V1.5.2 : .jxl / .avif dans comics_admin → adminOnly=true', () => {
  const dir = makeComicsDir('v152-admin');
  fs.writeFileSync(path.join(dir, 'x-0001.jxl'), 'jxl');
  fs.writeFileSync(path.join(dir, 'y-0001.avif'), 'avif');

  const comics = scanFolder(
    dir,
    'test/comics_admin',
    FOLDER_COMICS_ADMIN,
    []
  );

  assert.equal(comics.length, 2);
  for (const c of comics) {
    assert.equal(c.folder, 'comics_admin');
    assert.equal(c.adminOnly, true);
    assert.equal(c.hasVideo, false);
  }
});

test('V1.5.2 : doublon .png vs .jxl → .jxl gagne (alpha strict)', () => {
  const dir = makeComicsDir('v152-dup-png-jxl');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'png');
  fs.writeFileSync(path.join(dir, 'x-0001.jxl'), 'jxl');

  const warnings = [];
  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(comics.length, 1);
  assert.equal(comics[0].pages.length, 1);
  assert.equal(comics[0].pages[0].ext, 'jxl');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, REASONS.NUMERO_INVALIDE);
  assert.match(warnings[0].note, /\.jxl/);
});

test('V1.5.2 : doublon .avif vs .jxl → .avif gagne (alpha strict)', () => {
  const dir = makeComicsDir('v152-dup-avif-jxl');
  fs.writeFileSync(path.join(dir, 'x-0001.jxl'), 'jxl');
  fs.writeFileSync(path.join(dir, 'x-0001.avif'), 'avif');

  const warnings = [];
  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(comics[0].pages.length, 1);
  assert.equal(comics[0].pages[0].ext, 'avif');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].note, /\.avif/);
});

test('V1.5.2 : extension inconnue non affectée (.heic → warning)', () => {
  const dir = makeComicsDir('v152-heic');
  fs.writeFileSync(path.join(dir, 'x-0001.heic'), 'heic');

  const warnings = [];
  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, warnings);

  assert.equal(comics.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, REASONS.EXTENSION_NON_SUPPORTE);
});

// ---------------------------------------------------------------------------
// A4 — Normalisation lowercase
// ---------------------------------------------------------------------------

test('A4 : extension majuscule normalisée', () => {
  const dir = makeComicsDir('a4-uppercase-ext');
  fs.writeFileSync(path.join(dir, 'Comics_A-0001.PNG'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].name, 'comics_a');
  assert.equal(comics[0].pages[0].ext, 'png');
  assert.equal(comics[0].pages[0].file, 'comics_a-0001.png');
});

test('A4 : doublon avec casses différentes → un seul comics', () => {
  const dir = makeComicsDir('a4-dup-cases');
  fs.writeFileSync(path.join(dir, 'Comics_A-0001.PNG'), 'x');
  fs.writeFileSync(path.join(dir, 'comics_a-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].pages.length, 1);
});

test('A4 : .JXL majuscule normalisé en .jxl', () => {
  const dir = makeComicsDir('a4-jxl-uppercase');
  fs.writeFileSync(path.join(dir, 'Comics_A-0001.JXL'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].name, 'comics_a');
  assert.equal(comics[0].pages[0].ext, 'jxl');
});

// ---------------------------------------------------------------------------
// V1.5.3 — realName / realFile (casse réelle sur disque)
// ---------------------------------------------------------------------------

test(
  'V1.5.3 : scanFolder expose realFile (casse réelle sur disque)',
  { skip: onWindows && 'FS case-insensitive sur Windows' },
  () => {
    const dir = makeComicsDir('v153-realfile');
    fs.writeFileSync(path.join(dir, 'AxF2-0001.PNG'), 'x');

    const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
    assert.equal(comics.length, 1);
    assert.equal(comics[0].name, 'axf2');
    assert.equal(comics[0].pages[0].file, 'axf2-0001.png');
    assert.equal(comics[0].pages[0].realFile, 'AxF2-0001.PNG');
  }
);

test('V1.5.3 : realFile = file si le nom disque est déjà lowercase', () => {
  const dir = makeComicsDir('v153-realfile-same');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].pages[0].file, 'x-0001.png');
  assert.equal(comics[0].pages[0].realFile, 'x-0001.png');
});

test(
  'V1.5.3 : realFile cohérent après dédoublonnage A3 (casse mixte)',
  { skip: onWindows && 'FS case-insensitive sur Windows' },
  () => {
    const dir = makeComicsDir('v153-realfile-doublon');
    fs.writeFileSync(path.join(dir, 'AxF2-0001.PNG'), 'png');
    fs.writeFileSync(path.join(dir, 'AxF2-0001.JXL'), 'jxl');

    const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);

    assert.equal(comics[0].pages[0].ext, 'jxl');
    assert.equal(comics[0].pages[0].file, 'axf2-0001.jxl');
    assert.equal(comics[0].pages[0].realFile, 'AxF2-0001.JXL');
  }
);

test(
  'V1.5.3 : scanRoot expose realName (casse réelle du dossier)',
  { skip: onWindows && 'FS case-insensitive sur Windows' },
  () => {
    const dir = makeComicsDir('v153-realname');
    fs.mkdirSync(path.join(dir, 'Serie_Mixte', 'comics'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'Serie_Mixte', 'comics', 'AxF2-0001.PNG'),
      'x'
    );

    const { series } = scanRoot({ rootDir: dir });

    assert.ok(series.serie_mixte);
    assert.equal(series.serie_mixte.realName, 'Serie_Mixte');
    assert.equal(series.serie_mixte.comics[0].name, 'axf2');
    assert.equal(
      series.serie_mixte.comics[0].pages[0].realFile,
      'AxF2-0001.PNG'
    );
  }
);

test('V1.5.3 : realName = clé si le dossier est déjà lowercase', () => {
  const dir = makeComicsDir('v153-realname-same');
  fs.mkdirSync(path.join(dir, 'onepiece', 'comics'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'comics', 'a-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.realName, 'onepiece');
});

test(
  'V1.5.3 : scanRoot casse mixte complète (Serie_Mixte + comics_admin)',
  { skip: onWindows && 'FS case-insensitive sur Windows' },
  () => {
    const dir = makeComicsDir('v153-sr-casse');
    fs.mkdirSync(path.join(dir, 'Serie_Mixte', 'comics'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'Serie_Mixte', 'comics_admin'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, 'Serie_Mixte', 'comics', 'AxF2-0001.PNG'),
      'x'
    );
    fs.writeFileSync(
      path.join(dir, 'Serie_Mixte', 'comics', 'AxF2-0002.JXL'),
      'x'
    );
    fs.writeFileSync(
      path.join(dir, 'Serie_Mixte', 'comics_admin', 'AxF2-0007.JXL'),
      'x'
    );

    const { series } = scanRoot({ rootDir: dir });
    const s = series.serie_mixte;

    assert.ok(s);
    assert.equal(s.realName, 'Serie_Mixte');
    assert.equal(s.adminOnly, false);
    assert.equal(s.comics.length, 2);

    const normal = s.comics.find((c) => c.folder === 'comics');
    const admin = s.comics.find((c) => c.folder === 'comics_admin');
    assert.ok(normal);
    assert.ok(admin);

    assert.equal(normal.name, 'axf2');
    assert.equal(normal.pages.length, 2);
    assert.equal(normal.pages[0].realFile, 'AxF2-0001.PNG');
    assert.equal(normal.pages[1].realFile, 'AxF2-0002.JXL');

    assert.equal(admin.name, 'axf2');
    assert.equal(admin.adminOnly, true);
    assert.equal(admin.pages.length, 1);
    assert.equal(admin.pages[0].realFile, 'AxF2-0007.JXL');
  }
);

// ---------------------------------------------------------------------------
// A5 — Symlinks ignorés sans warning
// ---------------------------------------------------------------------------

test('A5 : symlink vers fichier ignoré sans warning', () => {
  const dir = makeComicsDir('a5-symlink');
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
  const dir = makeComicsDir('hv-image');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].pages[0].hasVideo, false);
});

test('V1.1 : hasVideo=true au niveau comics si au moins une vidéo', () => {
  const dir = makeComicsDir('hv-mixed');
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
  const dir = makeComicsDir('fold-comics');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/comics', FOLDER_COMICS, []);
  assert.equal(comics[0].folder, 'comics');
  assert.equal(comics[0].adminOnly, false);
});

test('V1.2 : scanFolder comics_admin → folder=comics_admin, adminOnly=true', () => {
  const dir = makeComicsDir('fold-comics-admin');
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
  const dir = makeComicsDir('fold-img-admin');
  fs.writeFileSync(path.join(dir, 'x-0001.png'), 'x');

  const comics = scanFolder(dir, 'test/img_admin', FOLDER_IMG_ADMIN, []);
  assert.equal(comics[0].folder, 'img_admin');
  assert.equal(comics[0].adminOnly, true);
});

// ---------------------------------------------------------------------------
// V1.2 — scanSerieFolders : fusion comics + comics_admin
// ---------------------------------------------------------------------------

test('V1.2 : scanSerieFolders fusionne comics + comics_admin', () => {
  const dir = makeComicsDir('sf-fusion');
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
  const dir = makeComicsDir('sf-sort-admin');
  fs.mkdirSync(path.join(dir, 'comics'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'comics_admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'comics', 'a-0001.png'), 'x');
  fs.writeFileSync(path.join(dir, 'comics_admin', 'a-0001.png'), 'x');

  const { comics } = scanSerieFolders(dir, 'test', []);
  assert.equal(comics[0].folder, 'comics');
  assert.equal(comics[1].folder, 'comics_admin');
});

test('V1.2 : scanSerieFolders avec seulement comics_admin', () => {
  const dir = makeComicsDir('sf-only-admin');
  fs.mkdirSync(path.join(dir, 'comics_admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'comics_admin', 'a-0001.png'), 'x');

  const { comics, img } = scanSerieFolders(dir, 'test', []);
  assert.equal(comics.length, 1);
  assert.equal(comics[0].folder, 'comics_admin');
  assert.equal(comics[0].adminOnly, true);
  assert.equal(img.length, 0);
});

test('V1.2 : scanSerieFolders avec img_admin', () => {
  const dir = makeComicsDir('sf-img-admin');
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
  const dir = makeComicsDir('sr-comics-normal');
  fs.mkdirSync(path.join(dir, 'onepiece', 'comics'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'comics', 'a-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.adminOnly, false);
});

test('V1.2 : série avec uniquement comics_admin → adminOnly=true', () => {
  const dir = makeComicsDir('sr-only-admin');
  fs.mkdirSync(path.join(dir, 'onepiece', 'comics_admin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'comics_admin', 'a-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.adminOnly, true);
});

test('V1.2 : série avec comics_admin + img normal → adminOnly=false', () => {
  const dir = makeComicsDir('sr-admin-img');
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
  const dir = makeComicsDir('sr-only-img-admin');
  fs.mkdirSync(path.join(dir, 'onepiece', 'img_admin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'onepiece', 'img_admin', 'a-0001.png'),
    'x'
  );

  const { series } = scanRoot({ rootDir: dir });
  assert.equal(series.onepiece.adminOnly, true);
});

// ---------------------------------------------------------------------------
// Tests existants (fixtures partagées root_tests/)
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
  // Test de LOG → temp autorisé + cleanup via after()
  const dir = makeLogDir('mpv2-warn-');
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