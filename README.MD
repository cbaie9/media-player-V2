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
git clone https://github.com/cbaie9/media-player-V2.git
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
Changelog
V1.2 (2026-10-06)
Suppression de toute référence à ffmpeg (aucune dépendance, aucune
vérification par npm run doctor).

Ajout d'une note sur les vignettes vidéo côté client et le cache
Cache Storage (§8.3, §10).

Ajout d'une note sur les fixtures E2E vidéo (sample.mp4
dev-only, §10).

Ajout d'une note sur recherche / filtres (§10).

Mise à jour de APP_LOG_FILE → ./logs/app.jsonl (§6.2).

V1.0 (2026-09-26)
Version initiale.

text

---


# Guide d'utilisation

## Connexion

Ouvrez <http://localhost:3000>. Si vous n'êtes pas connecté, vous êtes
redirigé vers le formulaire de login.

- **reader** — accès lecture complet
- **admin** — identique + peut relancer un scan

Après 5 tentatives échouées sur 15 minutes, l'IP est bloquée temporairement.

Le **badge de rôle** (pastille colorée + texte) est affiché à côté du
bouton Déconnexion sur toutes les pages protégées.

## Navigation
[Login] → [Liste des séries] → [Comics d'une série] → [Lecteur]

text

### Page « Séries »

Grille de toutes les séries détectées. Chaque carte affiche :

- Nom de la série
- Nombre de comics (`comics/`)
- Nombre d'imagesets (`img/`)

### Page « Série »

Deux onglets : **Comics** — contenu de `<serie>/comics/` — et **Images**
— contenu de `<serie>/img/`.

Cliquez sur une vignette pour ouvrir le lecteur.

#### Barre de recherche (V1.2)

En haut à droite, un champ de recherche **live** (débounce 250 ms) :

- Filtre les comics par **nom** (substring, insensible à la casse)
- **Scopé à l'onglet actif** (Comics OU Images)
- **Combiné en ET logique** avec le filtre [X, Y]
- Bouton **✕** pour effacer
- Si aucun résultat : tous les comics de l'onglet s'affichent, avec un
  message discret « aucun résultat »

> La recherche **ne matche pas** le numéro de page.

#### Filtre [X, Y] + tri (V1.2)

Sous les onglets, une ligne de filtres :

| Champ | Effet |
|-------|-------|
| Pages min | Borne inférieure de l'intervalle (inclusif, minimum forcé à 0) |
| Pages max | Borne supérieure (vide = ∞) |
| Tri | Alphabétique (défaut), Pages ↑, Pages ↓ |
| Reset | Réinitialise filtres + tri + recherche |

- Les bornes sont **persistées dans l'URL** (`?min=&max=&sort=`) et
  restaurées au rechargement
- Si `X > Y`, elles sont **inversées silencieusement**
- Le filtre est **réinitialisé au changement d'onglet**

### Lecteur

| Action | Effet |
|--------|-------|
| Flèche **←** | Page précédente |
| Flèche **→** ou **Espace** | Page suivante |
| **Échap** | Retour à la page de la série |
| Clic **moitié gauche** de l'image | Page précédente |
| Clic **moitié droite** de l'image | Page suivante |
| Clic sur la dernière page à droite | Ouvre l'overlay de fin |

**Vidéos** : pas de navigation par clic, utilisez les contrôles natifs du
navigateur + clavier.

### Fin de comics

Sur la dernière page :

- Cliquez sur **Suivant →** ou la **moitié droite** de l'image
- Un overlay s'affiche avec **3 suggestions aléatoires** de la même série
- Deux boutons : **Retour au menu** et **Fermer**

Les suggestions ne traversent **jamais** :

- La frontière entre `comics/` et `img/`
- La frontière entre séries

## Vignettes vidéo (V1.2)

Sur les pages **Série** et **Lecteur**, les comics contenant au moins une
vidéo affichent :

- Une **vignette** extraite automatiquement (frame 0, max 320 px)
- Un **overlay ▶** par-dessus
- Un **placeholder ▶** si l'extraction échoue (vidéo corrompue, codec
  non supporté, timeout 3 s sur Safari iOS, CORS bloqué)

L'extraction se fait **côté navigateur** au premier affichage, puis est
mise en **cache local** (`Cache Storage`, 500 entrées max, éviction FIFO).
Les affichages suivants sont instantanés.

Pour vider le cache manuellement : F12 → **Application → Cache Storage**
→ supprimer `media-thumbs-v1`.

## Astuces

### Vignettes lentes à charger ?

Elles sont en lazy-loading : elles ne se chargent que quand elles
entrent dans le viewport. Normal sur de grandes séries. Les vignettes
vidéo nécessitent une **première extraction** au premier affichage, puis
sont servies depuis le cache.

### Un comics n'apparaît pas ?

1. Ouvrez `logs/scan-warnings.log`
2. Cherchez le nom du fichier
3. Corrigez le nom pour respecter `%nom%-%0001.png`
4. Relancez `npm run rescan` (ou redémarrez le serveur)

### Ajouter une nouvelle série

1. Créez un dossier sous `ROOT_DIR` : `ROOT_DIR/masérie/`
2. Créez `masérie/comics/` et/ou `masérie/img/`
3. Placez-y vos fichiers avec le bon format de nom
4. `npm run rescan` (ou attendez le prochain redémarrage)

Le cache est mis à jour automatiquement. Sa **version 2** (V1.2) ajoute
le champ `hasVideo` par page et par comics.

### Forcer un rescan en tant qu'admin

Depuis une console avec votre cookie de session :

```bash
curl -X POST http://localhost:3000/api/rescan -b "connect.sid=..."
```
Ou en CLI (pas besoin d'être connecté) :

```bash
npm run rescan
```
Vérifier son rôle
```bash
curl http://localhost:3000/api/me -b "connect.sid=..."
```
# → {"username":"reader","role":"reader"}
Limites connues
Pas de sauvegarde de progression — vous reprenez toujours au début

Pas de recherche globale (uniquement sur la page Série)

Pas de tags

Pas de support CBZ / CBR / PDF

Deux comptes fixes — pas d'inscription

Raccourcis clavier — résumé
Touche	Contexte	Action
←	Lecteur	Page précédente
→	Lecteur	Page suivante
Espace	Lecteur	Page suivante
Échap	Lecteur	Retour à la série
Échap	Overlay fin	Fermer l'overlay
Tab	Partout	Naviguer entre les éléments focusables
Entrée	Login	Soumettre
Changelog
V1.2 (2026-10-06)
Ajout de la section Barre de recherche (§ Série).

Ajout de la section Filtre [X, Y] + tri (§ Série).

Ajout de la section Vignettes vidéo.

Mention du badge de rôle dans la section Connexion.

Ajout de l'endpoint /api/me dans les astuces.

Mise à jour de la liste des limites connues.

Suppression de toute référence à ffmpeg.
---