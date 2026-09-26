#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'root_tests');

/**
 * Arborescence de test conforme au §8.
 * Chaque entrée : { path, content } — le contenu peut être une string
 * quelconque, on ne teste pas le binaire ici.
 */
const FILES = [
  // serie_a / comics
  'serie_a/comics/comics_a-0001.png',
  'serie_a/comics/comics_a-0002.png',
  'serie_a/comics/comics_a-0003.mp4',
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
 * Doublons A3 : un même préfixe+numéro avec deux extensions.
 * Le .mp4 gagne sur le .png (ordre alpha : mp4 < png).
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

function makeFixtures({ withDuplicates = true } = {}) {
  // Nettoie et recrée
  fs.rmSync(FIXTURES_ROOT, { recursive: true, force: true });

  for (const rel of FILES) write(rel);
  if (withDuplicates) for (const rel of DUPLICATES) write(rel);

  return FIXTURES_ROOT;
}

module.exports = { makeFixtures, FIXTURES_ROOT, FILES, DUPLICATES };

if (require.main === module) {
  const root = makeFixtures();
  console.log(`✅ Fixtures générées dans ${root}`);
}