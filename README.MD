# media-player-v2

Lecteur web auto-hébergé de comics/mangas (LAN ou VPN privé).

Conçu pour deux utilisateurs authentifiés (`reader`, `admin`), sans base de
données, sans sauvegarde de progression, sans fonctionnalité sociale.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Structure des médias](#structure-des-médias)
- [Utilisation](#utilisation)
- [Scripts](#scripts)
- [Tests](#tests)
- [Sécurité](#sécurité)
- [Licence](#licence)

## Fonctionnalités

- 🔐 Authentification obligatoire (2 comptes prédéfinis, bcrypt, sessions cookie)
- 📚 Découverte automatique des séries et comics par scan de dossier
- 🖼️ Lecteur page par page pour images **et** vidéos
- ⌨️ Navigation clavier (← → Espace Échap)
- 👆 Clic moitié gauche / droite sur les images
- 🎲 Fin de comics → 3 suggestions aléatoires de la même série
- 💾 Cache de scan JSON + rescan à la demande
- 📱 Responsive mobile et desktop
- ♿ HTML sémantique, WCAG AA, W3C + Wave compliant

## Prérequis

- **Node.js ≥ 20**
- Aucun SGBD (tout est fichiers)

## Installation

```bash
git clone <repo> media-player-v2
cd media-player-v2
npm install
npm run init          # génère .env + config/config.json
```

Génère ensuite les deux hash bcrypt :

```bash
node scripts/hash-password.js
```

Copie les hashs dans `config/users.json` (modèle : `config/users.example.json`).
Édite `config/config.json` pour pointer `ROOT_DIR` vers ta médiathèque.

## Configuration

Fichiers concernés (gitignored) :

| Fichier | Rôle |
|---------|------|
| `.env` | `SESSION_SECRET` (64 hex, généré par `npm run init`) |
| `config/config.json` | Configuration applicative |
| `config/users.json` | Hash bcrypt des 2 comptes |

### `config/config.json`

```json
{
  "ROOT_DIR": "/chemin/absolu/vers/racine",
  "USERS_FILE": "./config/users.json",
  "CACHE_FILE": "./cache/scan.json",
  "WARNINGS_FILE": "./logs/scan-warnings.log",
  "APP_LOG_FILE": "./logs/app.jsonl",
  "SESSION_MAX_AGE_HOURS": 24,
  "PORT": 3000,
  "HTTPS": false,
  "SCAN_ON_START": true,
  "LOGIN_RATE_LIMIT": { "windowMinutes": 15, "maxAttempts": 5 }
}
```

### `config/users.json`

```json
{
  "reader": { "password_hash": "$2b$12$..." },
  "admin":  { "password_hash": "$2b$12$..." }
}
```

## Structure des médias

```
/racine/
  onepiece/                 ← une série = un dossier
    comics/                 ← comics (images + vidéos)
      comics_a-0001.png
      comics_a-0002.png
      comics_a-0003.mp4
      comics_b-0001.png
    img/                    ← imagesets (images + vidéos)
      cover_a-0001.png
  naruto/
    comics/
      chap01-0001.png
```

### Règles de nommage

Format strict : `%nom%-%numero_page%.%extension%`

- Séparateur **exactement** un tiret `-`
- Numéro sur **4 ou 6 chiffres** (zéro-padded) : `0001` ou `000001`
- Extensions : `.png .jpg .jpeg .webp .gif .mp4 .webm`
- Le `%nom%` peut contenir des tirets, seul le **dernier tiret suivi de chiffres**
  est considéré comme séparateur
- Les fichiers non conformes sont ignorés et loggés dans
  `logs/scan-warnings.log`

Tous les fichiers partageant le même `%nom%` dans un même dossier forment
un **seul comics**, trié par numéro de page.

## Utilisation

```bash
npm start
```

Ouvre http://localhost:3000 → login → navigation.

### Navigation clavier

| Touche | Action |
|--------|--------|
| `←` | Page précédente |
| `→` ou `Espace` | Page suivante |
| `Échap` | Retour au menu (ou ferme l'overlay) |

### Navigation souris (images uniquement)

- Clic sur la **moitié gauche** → page précédente
- Clic sur la **moitié droite** → page suivante
- Clic sur la dernière page à droite → overlay de fin

## Scripts

| Commande | Description |
|----------|-------------|
| `npm start` | Démarre le serveur |
| `npm run init` | Génère `.env` + `config/config.json` |
| `npm run rescan` | Relance un scan complet (sans HTTP) |
| `npm run hash-password` | Hash bcrypt interactif |
| `npm test` | Unit + intégration + E2E (fail fast) |
| `npm run test:unit` | Tests unitaires |
| `npm run test:integration` | Tests d'intégration (supertest) |
| `npm run test:e2e` | Tests Playwright |

### Endpoints

| Méthode | URL | Rôle requis |
|---------|-----|-------------|
| `POST` | `/login` | — |
| `POST` | `/logout` | authentifié |
| `GET` | `/api/series` | authentifié |
| `GET` | `/api/series/:serie` | authentifié |
| `GET` | `/api/series/:serie/:folder/:name` | authentifié |
| `GET` | `/api/series/:serie/:folder/:name/suggestions` | authentifié |
| `POST` | `/api/rescan` | admin |
| `GET` | `/media/:serie/:folder/:file` | authentifié |

## Tests

```bash
npm test
```

Exécution dans l'ordre :

1. `tests/unit/` — parser, sécurité, cache, logger, store, suggest, auth
2. `tests/integration/` — auth, api, media (via supertest)
3. `tests/e2e/` — Playwright (login, series, reader, fin de comics)

Le serveur E2E utilise `tests/e2e/server-fixture.js` avec un ROOT_DIR
isolé (`.tmp-root/`), il ne touche pas à ta config réelle.

## Sécurité

- Mots de passe **bcrypt** (coût ≥ 12)
- Sessions **cookie HttpOnly + SameSite=Strict** (+ `Secure` si HTTPS)
- **Rate limit** : 5 tentatives / 15 min / IP sur `/login`, reset au succès
- **Protection path traversal** : `fs.realpathSync` + vérification
  `startsWith(ROOT_DIR + sep)` sur **chaque** requête média (contre les
  symlinks sortants)
- **Timing-safe login** : `bcrypt.compare` appelé même si l'utilisateur
  n'existe pas
- Le site n'est **pas destiné** à être exposé publiquement.
  Utilise-le via **LAN** ou **VPN privé**. HTTP est toléré, HTTPS recommandé.

## Licence

MIT — voir [LICENSE](./LICENSE).