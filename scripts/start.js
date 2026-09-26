#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const bcrypt = require('bcrypt');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'config.json');
const USERS_PATH = path.join(PROJECT_ROOT, 'config', 'users.json');

/**
 * Détecte si un compte utilise encore le mot de passe par défaut.
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function isDefaultPassword(hash) {
  try {
    return await bcrypt.compare('changeme', hash);
  } catch {
    return false;
  }
}

/**
 * Prompt interactif simple.
 */
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Prompt masqué (mot de passe).
 */
function askPassword(label) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    stdout.write(label);

    let password = '';
    const onData = (char) => {
      const c = char.toString('utf8');
      if (c === '\n' || c === '\r' || c === '\u0004') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        stdin.pause();
        stdout.write('\n');
        resolve(password);
      } else if (c === '\u0003') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdout.write('\n');
        process.exit(130);
      } else if (c === '\u007f' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += c;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Vérifie les pré-requis et propose de corriger si nécessaire.
 * @returns {Promise<void>}
 */
async function preflight() {
  // 1. Vérifier .env
  if (!fs.existsSync(ENV_PATH)) {
    console.error('\n❌ .env manquant.');
    console.error('   Lancez :  npm run init\n');
    process.exit(1);
  }

  // 2. Vérifier config.json
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('\n❌ config/config.json manquant.');
    console.error('   Lancez :  npm run init\n');
    process.exit(1);
  }

  // 3. Vérifier users.json
  if (!fs.existsSync(USERS_PATH)) {
    console.error('\n❌ config/users.json manquant.');
    console.error('   Lancez :  npm run init\n');
    process.exit(1);
  }

  // 4. Lire les hashs
  let users;
  try {
    users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (err) {
    console.error(`\n❌ config/users.json invalide : ${err.message}\n`);
    process.exit(1);
  }

  // 5. Détecter "changeme"
  const readerDefault = users.reader && (await isDefaultPassword(users.reader.password_hash));
  const adminDefault = users.admin && (await isDefaultPassword(users.admin.password_hash));

  if (!readerDefault && !adminDefault) {
    // Tout est bon, on peut démarrer
    return;
  }

  // 6. Un des deux (ou les deux) utilisent "changeme"
  console.log('\n' + '='.repeat(60));
  console.log('⚠️  Mot de passe par défaut détecté !');
  console.log('='.repeat(60));
  console.log('');
  console.log(
    'Pour des raisons de sécurité, vous devez définir des mots de passe'
  );
  console.log('personnalisés avant de démarrer le serveur.');
  console.log('');

  if (!process.stdin.isTTY) {
    console.error(
      '❌ Impossible de demander les mots de passe en mode non-interactif.'
    );
    console.error('   Lancez :  npm run init --force\n');
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (readerDefault) {
      const pwd = await askPassword('🔑 Nouveau mot de passe pour "reader" : ');
      if (pwd.length < 6) {
        console.error('❌ Mot de passe trop court (6 caractères minimum).\n');
        process.exit(1);
      }
      const confirm = await askPassword('   Confirmez : ');
      if (pwd !== confirm) {
        console.error('❌ Les mots de passe ne correspondent pas.\n');
        process.exit(1);
      }
      users.reader.password_hash = await bcrypt.hash(pwd, 12);
    }

    if (adminDefault) {
      const pwd = await askPassword('🔑 Nouveau mot de passe pour "admin"  : ');
      if (pwd.length < 6) {
        console.error('❌ Mot de passe trop court (6 caractères minimum).\n');
        process.exit(1);
      }
      const confirm = await askPassword('   Confirmez : ');
      if (pwd !== confirm) {
        console.error('❌ Les mots de passe ne correspondent pas.\n');
        process.exit(1);
      }
      users.admin.password_hash = await bcrypt.hash(pwd, 12);
    }
  } finally {
    rl.close();
  }

  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  console.log('\n✅ Comptes mis à jour.\n');
}

/**
 * Démarre le serveur.
 */
async function start() {
  await preflight();

  // Charge et lance le serveur
  const serverPath = path.join(PROJECT_ROOT, 'src', 'server.js');
  require(serverPath);
}

start().catch((err) => {
  console.error(`\n❌ Erreur au démarrage : ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
});