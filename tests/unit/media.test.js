'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRange } = require('../../src/routes/media');

test('parseRange retourne null si header absent', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.equal(parseRange('', 100), null);
});

test('parseRange bytes=0-99 sur 1000', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
});

test('parseRange bytes=100- sur 1000 → fin auto', () => {
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 });
});

test('parseRange bytes=-100 sur 1000 → 100 derniers', () => {
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
});

test('parseRange bytes=500-2000 sur 1000 → tronqué', () => {
  assert.deepEqual(parseRange('bytes=500-2000', 1000), { start: 500, end: 999 });
});

test('parseRange invalide → null', () => {
  assert.equal(parseRange('bytes=abc', 100), null);
  assert.equal(parseRange('items=0-10', 100), null);
  assert.equal(parseRange('bytes=200-100', 100), null);
  assert.equal(parseRange('bytes=200-', 100), null); // start > size
});