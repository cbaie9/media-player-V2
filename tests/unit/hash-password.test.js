'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, COST } = require('../../scripts/hash-password');

test('hashPassword produit un hash bcrypt valide', async () => {
  const hash = await hashPassword('secret123');
  assert.match(hash, /^\$2b\$\d{2}\$/);
  assert.ok(hash.length >= 60);
});

test('verifyPassword accepte le bon mot de passe', async () => {
  const hash = await hashPassword('secret123');
  assert.equal(await verifyPassword('secret123', hash), true);
});

test('verifyPassword rejette le mauvais mot de passe', async () => {
  const hash = await hashPassword('secret123');
  assert.equal(await verifyPassword('mauvais', hash), false);
});

test('hashPassword rejette un mot de passe vide', async () => {
  await assert.rejects(() => hashPassword(''), /non-empty/);
  await assert.rejects(() => hashPassword(null), /non-empty/);
});

test('hashPassword utilise le coût attendu par défaut', async () => {
  const hash = await hashPassword('x');
  const cost = parseInt(hash.split('$')[2], 10);
  assert.equal(cost, COST);
});

test('deux hashs du même mot de passe sont différents (salt)', async () => {
  const h1 = await hashPassword('same');
  const h2 = await hashPassword('same');
  assert.notEqual(h1, h2);
});