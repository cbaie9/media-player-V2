'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFilename,
  typeFromExt,
} = require('../../src/utils/parseFilename');

test('valide 4 chiffres', () => {
  const r = parseFilename('comics_a-0001.png');
  assert.deepEqual(r, { name: 'comics_a', page: 1, pageRaw: '0001', ext: 'png' });
});

test('valide 6 chiffres', () => {
  const r = parseFilename('long_nom_de_serie-123456.mp4');
  assert.equal(r.name, 'long_nom_de_serie');
  assert.equal(r.page, 123456);
  assert.equal(r.ext, 'mp4');
});

test('rejette extension inconnue', () => {
  assert.equal(parseFilename('comics_a-0001.tiff'), null);
});

test('rejette tiret manquant', () => {
  assert.equal(parseFilename('comics_a0001.png'), null);
});

test('rejette underscore comme séparateur', () => {
  assert.equal(parseFilename('comics_a_0001.png'), null);
});

test('normalise lowercase sur nom + extension', () => {
  const r = parseFilename('Comics_A-0001.PNG');
  assert.equal(r.name, 'comics_a');
  assert.equal(r.ext, 'png');
});

test('gère nom avec tirets multiples (dernier tiret = séparateur)', () => {
  const r = parseFilename('mon-comics-2-0042.webp');
  assert.equal(r.name, 'mon-comics-2');
  assert.equal(r.page, 42);
});

test('rejette fichier caché', () => {
  assert.equal(parseFilename('.hidden-0001.png'), null);
});

test('rejette chaîne vide', () => {
  assert.equal(parseFilename(''), null);
  assert.equal(parseFilename(null), null);
  assert.equal(parseFilename(undefined), null);
});

test('rejette 3 chiffres', () => {
  assert.equal(parseFilename('comics_a-001.png'), null);
});

test('rejette 5 chiffres', () => {
  assert.equal(parseFilename('comics_a-00001.png'), null);
});

test('rejette 7 chiffres', () => {
  assert.equal(parseFilename('comics_a-0000001.png'), null);
});

test('rejette page absente', () => {
  assert.equal(parseFilename('comics_a-.png'), null);
  assert.equal(parseFilename('comics_a.png'), null);
});

test('rejette nom vide avant tiret', () => {
  assert.equal(parseFilename('-0001.png'), null);
});

test('rejette extension composée', () => {
  assert.equal(parseFilename('comics_a-0001.png.bak'), null);
});

test('typeFromExt image', () => {
  assert.equal(typeFromExt('png'), 'image');
  assert.equal(typeFromExt('jpg'), 'image');
  assert.equal(typeFromExt('jpeg'), 'image');
  assert.equal(typeFromExt('webp'), 'image');
  assert.equal(typeFromExt('gif'), 'image');
});

test('typeFromExt video', () => {
  assert.equal(typeFromExt('mp4'), 'video');
  assert.equal(typeFromExt('webm'), 'video');
});

test('typeFromExt inconnu', () => {
  assert.equal(typeFromExt('tiff'), null);
});