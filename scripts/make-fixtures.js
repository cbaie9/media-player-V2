#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'root_tests');
const SAMPLE_VIDEO_PATH = path.join(
  PROJECT_ROOT, 'tests', 'fixtures', 'assets', 'sample.mp4'
);

/**
 * Arborescence de test conforme au §8.
 * Chaque entrée : chemin relatif. Le contenu est écrit par `write()`,
 * sauf pour les vidéos qui passent par `writeVideoOrFake()`.
 */
const FILES = [
  // serie_a / comics
  'serie_a/comics/comics_a-0001.png',
  'serie_a/comics/comics_a-0002.png',
  // NOTE : comics_a-0003.mp4 est géré à part (writeVideoOrFake)
  'serie_a/comics/comics_b-0001.png',
  // serie_a / img
  'serie_a/img/cover_a-0001.png',
  // serie_b / comics
  'serie_b/comics/chap01-0001.png',

  // Fichiers NON conformes → doivent finir dans scan-warnings.log
  'serie_a/comics/cover.png',              // nom_non_conforme
  'serie_a/comics/notes.txt',              // extension_non_supporte
  'serie_a/comics/comics_a-01.png',        // numero_invalide
  'serie_a/comics/.hidden-0001.png',       // fichier caché → nom_non_conforme
  'serie_b/comics/readme.md',              // extension_non_supporte
];

/**
 * Vidéos : gérées séparément car leur contenu conditionne les tests E2E.
 */
const VIDEO_FILES = [
  'serie_a/comics/comics_a-0003.mp4',
];

/**
 * Doublons A3 : un même préfixe+numéro avec deux extensions.
 * Le .png gagne sur le .mp4 (priorité image).
 */
const DUPLICATES = [
  'serie_a/comics/dup-0001.png',
  'serie_a/comics/dup-0001.mp4',
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function write(relPath, content = 'x') {
  const abs = path.join(FIXTURES_ROOT, relPath);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, content);
}

/**
 * Écrit une "vidéo" de fixture :
 *  - Si tests/fixtures/assets/sample.mp4 existe, on la copie (vraie vidéo).
 *  - Sinon, on écrit un fichier factice (texte) : l'extraction échouera
 *    et les tests E2E correspondants seront skippés.
 *
 * @returns {'real'|'fake'}
 */
function writeVideoOrFake(relPath) {
  const abs = path.join(FIXTURES_ROOT, relPath);
  ensureDir(path.dirname(abs));

  if (fs.existsSync(SAMPLE_VIDEO_PATH)) {
    fs.copyFileSync(SAMPLE_VIDEO_PATH, abs);
    return 'real';
  }
  // Fallback : contenu non-vidéo. L'extension reste .mp4 pour que le
  // scanner continue de produire un comics valide.
  fs.writeFileSync(abs, 'FAKE_MP4_FIXTURE\n', 'utf8');
  return 'fake';
}

/**
 * Génère les fixtures.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.withDuplicates=true]
 * @returns {string} FIXTURES_ROOT
 */
function makeFixtures({ withDuplicates = true } = {}) {
  fs.rmSync(FIXTURES_ROOT, { recursive: true, force: true });

  for (const rel of FILES) write(rel);
  for (const rel of VIDEO_FILES) writeVideoOrFake(rel);
  if (withDuplicates) {
    for (const rel of DUPLICATES) {
      if (rel.endsWith('.mp4')) writeVideoOrFake(rel);
      else write(rel);
    }
  }

  return FIXTURES_ROOT;
}

/**
 * Indique si une vraie vidéo est disponible.
 * Utilisé par les tests E2E pour skip élégamment.
 * @returns {boolean}
 */
function hasRealVideo() {
  return fs.existsSync(SAMPLE_VIDEO_PATH);
}

module.exports = {
  makeFixtures,
  hasRealVideo,
  FIXTURES_ROOT,
  SAMPLE_VIDEO_PATH,
  FILES,
  VIDEO_FILES,
  DUPLICATES,
};

if (require.main === module) {
  const root = makeFixtures();
  const real = hasRealVideo();
  console.log(`✅ Fixtures générées dans ${root}`);
  if (!real) {
    console.log(
      '⚠️  Aucune vraie vidéo (tests/fixtures/assets/sample.mp4 absent).\n' +
      '   Les tests E2E "video-thumb" seront skippés.'
    );
  }
}