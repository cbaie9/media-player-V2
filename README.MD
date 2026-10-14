# media-player-v2

Lecteur web auto-hébergé de comics/mangas (LAN ou VPN privé).

Conçu pour deux utilisateurs authentifiés (`reader`, `admin`), sans base de données, sans sauvegarde de progression, sans fonctionnalité sociale.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Structure des médias](#structure-des-médias)
- [Restriction d'accès (admin-only)](#restriction-daccès-admin-only)
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
- 🎲 Fin de comics → jusqu'à **6** suggestions aléatoires de la même série
- 💾 Cache de scan JSON + rescan à la demande
- 🔒 **Restriction d'accès** : certains comics/img ne sont visibles que par l'admin
- 📱 Responsive mobile et desktop
- ♿ HTML sémantique, WCAG AA, W3C + Wave compliant

## Prérequis

- **Node.js ≥ 20**
- Aucun SGBD (tout est fichiers)

## Installation

```bash
git clone https://github.com/cbaie9/media-player-V2.git
cd media-player-v2
npm install
npm run init          # génère .env + config/config.json
```

Génère ensuite les deux hash bcrypt :

```bash
node scripts/hash-password.js
```

Copie les hashs dans `config/users.json` (modèle : `config/users.example.json`). Édite `config/config.json` pour pointer `ROOT_DIR` vers ta médiathèque.

## Configuration

Fichiers concernés (gitignored) :

| Fichier | Rôle |
|---|---|
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

```text
/racine/
  onepiece/                 ← une série = un dossier
    comics/                 ← comics publics (images + vidéos)
      comics_a-0001.png
      comics_a-0002.png
      comics_a-0003.mp4
      comics_b-0001.png
    comics_admin/           ← V1.2 : comics admin-only
      secret_a-0001.png
      secret_a-0002.png
    img/                    ← imagesets publics (images + vidéos)
      cover_a-0001.png
    img_admin/              ← V1.2 : imagesets admin-only
      secret_img-0001.png
  naruto/
    comics/
      chap01-0001.png
    comics_admin/           ← mélange possible : naruto reste non-admin
      secret_chap-0001.png
  admin_series/             ← V1.2 : série entièrement admin-only
    comics_admin/
      private_a-0001.png
      private_a-0002.png
    img_admin/
      private_img-0001.png
```

### Règles de nommage

Format strict : `%nom%-%numero_page%.%extension%`

- Séparateur **exactement** un tiret `-`
- Numéro sur **4, 5 ou 6 chiffres** (zéro-padded) : `0001`, `00001` ou `000001`
- Extensions : `.png .jpg .jpeg .webp .gif .mp4 .webm`
- Le `%nom%` peut contenir des tirets, seul le **dernier tiret suivi de chiffres** est considéré comme séparateur
- Les fichiers non conformes sont ignorés et loggés dans `logs/scan-warnings.log`

Tous les fichiers partageant le même `%nom%` dans un même dossier forment un **seul comics**, trié par numéro de page.

### Dossiers reconnus

Depuis V1.2, le scanner reconnaît **4 dossiers** par série :

| Dossier | Base | Visibilité |
|---|---|---|
| `comics/` | comics | reader + admin |
| `comics_admin/` | comics | **admin uniquement** |
| `img/` | img | reader + admin |
| `img_admin/` | img | **admin uniquement** |

**Règles associées :**

- Les dossiers `comics/` et `comics_admin/` sont **complémentaires** : pour un admin, ils forment un seul ensemble logique. Pour un reader, seuls les comics de `comics/` existent.
- Idem pour `img/` et `img_admin/`.
- Une **série** est dite *admin-only* si elle ne contient **aucun** comics/img accessible au reader (c.-à-d. uniquement des dossiers `_admin`). Elle est alors totalement invisible pour un reader.
- **Un même nom de comics peut exister à la fois dans `comics/` et dans `comics_admin/`** : ce sont alors **2 comics distincts** (mêmes nom et cover, mais contenu et accès différents).

## Restriction d'accès (admin-only)

### Fonctionnement

Pour un **reader** :

- Les dossiers `comics_admin/` et `img_admin/` sont **totalement invisibles** (comme s'ils n'existaient pas).
- Une série entièrement admin-only est **absente** de la liste des séries.
- L'accès direct par URL (`/reader/.../comics_admin/...`, `/media/.../comics_admin/...`) renvoie **404 Not Found** (pas de fuite d'existence).
- Les **suggestions de fin de comics** ne proposent **jamais** de comics admin.

Pour un **admin** :

- Tous les dossiers sont visibles.
- Les comics admin-only portent un badge 🔒 (à côté du nom) sur les pages Séries, Série, et dans les suggestions de fin de comics.
- Les **suggestions** croisent `comics/` ↔ `comics_admin/` (et `img/` ↔ `img_admin/`), donc un comics public peut recommander un comics admin et inversement.
- La frontière `comics*` ↔ `img*` reste **étanche** : un comics ne recommande jamais une image, et inversement.

### Marquer un comics comme admin-only

Il suffit de le **placer dans un dossier `_admin`** :

```text
onepiece/
  comics/         comics_a-0001.png      ← visible par tous
  comics_admin/   comics_a-0001.png      ← visible par admin uniquement
```

Aucune configuration n'est nécessaire. Le rescan au démarrage détecte automatiquement les dossiers `_admin`.

### Marquer une série entière comme admin-only

Il suffit que la série ne contienne **aucun** dossier non-admin :

```text
ma_serie/
  comics_admin/
    secret-0001.png
  img_admin/
    cover-0001.png
```

→ `ma_serie` est admin-only.

## Utilisation

```bash
npm start
```

Ouvre http://localhost:3000 → login → navigation.

### Navigation clavier

| Touche | Action |
|---|---|
| `←` | Page précédente |
| `→` ou `Espace` | Page suivante |
| `Échap` | Retour au menu (ou ferme l'overlay) |

### Navigation souris (images uniquement)

- Clic sur la **moitié gauche** → page précédente
- Clic sur la **moitié droite** → page suivante
- Clic sur la dernière page à droite → overlay de fin

## Scripts

| Commande | Description |
|---|---|
| `npm start` | Démarre le serveur (rescan forcé au démarrage) |
| `npm run init` | Génère `.env` + `config/config.json` |
| `npm run rescan` | Relance un scan complet (sans HTTP) |
| `npm run hash-password` | Hash bcrypt interactif |
| `npm test` | Unit + intégration + E2E (fail fast) |
| `npm run test:unit` | Tests unitaires |
| `npm run test:integration` | Tests d'intégration (supertest) |
| `npm run test:e2e` | Tests Playwright |

### Endpoints

| Méthode | URL | Rôle requis |
|---|---|---|
| `POST` | `/login` | — |
| `POST` | `/logout` | authentifié |
| `GET` | `/api/me` | authentifié |
| `GET` | `/api/series` | authentifié (filtré par rôle) |
| `GET` | `/api/series/:serie` | authentifié (filtré par rôle) |
| `GET` | `/api/series/:serie/:folder/:name` | authentifié (filtré par rôle) |
| `GET` | `/api/series/:serie/:folder/:name/suggestions` | authentifié (jusqu'à 6) |
| `POST` | `/api/rescan` | admin |
| `GET` | `/media/:serie/:folder/:file` | authentifié (filtré par rôle) |

`folder` accepte 4 valeurs : `comics`, `comics_admin`, `img`, `img_admin`.

### Réponses API — filtrage par rôle

`GET /api/series` (reader) :

```json
{
  "series": [
    { "name": "onepiece", "comicsCount": 3, "imgCount": 1, "adminOnly": false }
  ]
}
```

`GET /api/series` (admin) :

```json
{
  "series": [
    { "name": "admin_series", "comicsCount": 2, "imgCount": 1, "adminOnly": true },
    { "name": "naruto", "comicsCount": 1, "imgCount": 0, "adminOnly": false },
    { "name": "onepiece", "comicsCount": 4, "imgCount": 2, "adminOnly": false }
  ]
}
```

`GET /api/series/onepiece` (admin) :

```json
{
  "name": "onepiece",
  "adminOnly": false,
  "comics": [
    { "name": "comics_a", "folder": "comics", "adminOnly": false, "pageCount": 3, "cover": "comics_a-0001.png", "hasVideo": false },
    { "name": "secret_a", "folder": "comics_admin", "adminOnly": true, "pageCount": 2, "cover": "secret_a-0001.png", "hasVideo": false }
  ],
  "img": [
    { "name": "cover_a", "folder": "img", "adminOnly": false, "pageCount": 1, "cover": "cover_a-0001.png", "hasVideo": false },
    { "name": "secret_img", "folder": "img_admin", "adminOnly": true, "pageCount": 1, "cover": "secret_img-0001.png", "hasVideo": false }
  ]
}
```

## Tests

```bash
npm test
```

Exécution dans l'ordre :

1. `tests/unit/` — parser, sécurité, cache, logger, scanner, store, suggest, filter, auth, config
2. `tests/integration/` — auth, api, media (via supertest)
3. `tests/e2e/` — Playwright (login, series, serie, reader, search, filter, end-of-comics, video-thumb, admin-lock)

Le serveur E2E utilise `tests/e2e/server-fixture.js` avec un `ROOT_DIR` isolé (`.tmp-root/`), il ne touche pas à ta config réelle.

## Sécurité

- Mots de passe **bcrypt** (coût ≥ 12)
- Sessions **cookie HttpOnly + SameSite=Strict** (+ `Secure` si HTTPS)
- **Rate limit** : 5 tentatives / 15 min / IP sur `/login`, reset au succès
- **Protection path traversal** : `fs.realpathSync` + vérification `startsWith(ROOT_DIR + sep)` sur **chaque** requête média (contre les symlinks sortants)
- **Timing-safe login** : `bcrypt.compare` appelé même si l'utilisateur n'existe pas
- **Filtrage admin-only** : les dossiers `_admin` sont filtrés à **4 niveaux** :
  1. Scan (le scanner ne « range » pas les admin avec les normaux)
  2. API (`store.listSeries(role)`, `store.getSerie(serie, role)`, `store.getComics(..., role)`)
  3. Media (`/media/...` rejette en 404 avant toute I/O disque)
  4. Suggestions (pool filtré par rôle)
- Le site n'est **pas destiné** à être exposé publiquement. Utilise-le via **LAN** ou **VPN privé**. HTTP est toléré, HTTPS recommandé.

## Licence

MIT — voir LICENSE.

---

## Changelog

### V1.2 (2026-10-14)

**Restriction d'accès admin-only**

- Nouveaux dossiers `comics_admin/` et `img_admin/`, en parallèle de `comics/` et `img/`.
- Une **série** est admin-only si elle n'a aucun comics/img accessible au reader.
- Un **reader** ne voit ni la série admin-only ni les comics/img admin-only (404 en cas d'accès direct).
- Un **admin** voit tout, avec un badge 🔒 visuel sur les éléments admin-only (cartes de série, cartes de comics, suggestions de fin).

**Suggestions**

- Passage de **3 à 6** suggestions en fin de comics.
- Pour un **admin**, les suggestions croisent `comics/` ↔ `comics_admin/` (et `img/` ↔ `img_admin/`).
- Pour un **reader**, seules les suggestions publiques sont proposées.
- La frontière `comics*` ↔ `img*` reste **étanche** dans tous les cas.
- Les slots vides comblent l'overlay jusqu'à 6 emplacements visuels.

**UI**

- **Onglets masqués** quand vides (un onglet sans item n'apparaît pas).
- **Redirection auto** vers l'onglet Images si l'onglet Comics est vide.
- Message **« Cette série est vide. »** si rien n'est accessible.
- Persistance de l'onglet actif dans l'URL (`?tab=img`).
- Badge 🔒 sur les items admin-only (visible admin uniquement).

**Technique**

- Cache de scan bumpé en **version 3** (ajout de `folder` et `adminOnly` par comics, `adminOnly` par série).
- **Rescan forcé au démarrage** (`npm start`) pour détecter immédiatement les nouveaux dossiers `_admin`.
- Whitelist des folders étendue à 4 valeurs.
- Nouveau middleware de filtrage par rôle dans `store.js` et `routes/media.js`.

**Tests**

- Nouveaux tests unitaires (`scanner`, `store`, `suggest`, `cache`).
- Nouveaux tests d'intégration (`api`, `media`) avec fixtures `_admin`.
- Nouveau spec E2E `admin-lock.spec.js` (15 tests).
- Mise à jour de `end-of-comics.spec.js` (6 suggestions + slots vides).

### V1.1 (2026-10-06)

- Suppression de toute référence à ffmpeg (aucune dépendance, aucune vérification par `npm run doctor`).
- Ajout d'une note sur les vignettes vidéo côté client et le cache Cache Storage (§8.3, §10).
- Ajout d'une note sur les fixtures E2E vidéo (`sample.mp4` dev-only, §10).
- Ajout d'une note sur recherche / filtres (§10).
- Mise à jour de `APP_LOG_FILE` → `./logs/app.jsonl` (§6.2).

### V1.0 (2026-09-26)

- Version initiale.