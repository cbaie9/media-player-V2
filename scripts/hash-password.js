#!/usr/bin/env node
'use strict';

const bcrypt = require('bcrypt');
const readline = require('node:readline');

const COST = 12; // §11 : bcrypt coût ≥ 12

/**
 * Demande un mot de passe en interactif (masqué) puis retourne son hash.
 * @returns {Promise<string>} hash bcrypt
 */
async function promptPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Masquage simple de la saisie
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let password = '';
    process.stdout.write('Mot de passe à hasher : ');

    const onData = (char) => {
      const c = char.toString('utf8');
      if (c === '\n' || c === '\r' || c === '\u0004') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(130);
      } else if (c === '\u007f') {
        // Backspace
        password = password.slice(0, -1);
      } else {
        password += c;
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Hash un mot de passe avec bcrypt.
 * @param {string} password
 * @param {number} [cost=COST]
 * @returns {Promise<string>}
 */
async function hashPassword(password, cost = COST) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  return bcrypt.hash(password, cost);
}

/**
 * Vérifie un mot de passe contre un hash bcrypt.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function main() {
  const password = await promptPassword();
  if (!password) {
    console.error('Erreur : mot de passe vide.');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  console.log('\nHash bcrypt :');
  console.log(hash);
  console.log('\nÀ coller dans config/users.json :');
  console.log(JSON.stringify({ password_hash: hash }, null, 2));
}

module.exports = { hashPassword, verifyPassword, promptPassword, COST };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}