================================================================================
CONCEPTION DÉTAILLÉE — MEDIA PLAYER V2
Lecteur web de comics/mangas
================================================================================
Version  : 2.0
Statut   : Conception détaillée — approuvée, prête pour implémentation
Prérequis: V1_cdc_passation.md (v1.0)
Public   : Agent IA développeur
================================================================================


--------------------------------------------------------------------------------
§1 DÉCISIONS FIGÉES
--------------------------------------------------------------------------------

Toutes les décisions ci-dessous ont été validées et sont non négociables
pour la V1. Elles complètent et précisent le cahier des charges V1.

BLOC A — PARSING
  A1. Regex : ^(?<name>.+)-(?<page>\d{4}|\d{6})\.(?<ext>png|jpe?g|webp|gif|mp4|webm)$
  A2. Fichiers non conformes : ignorés + loggés dans logs/scan-warnings.log
  A3. Ordre de priorité dédoublonnage : alphabétique strict des extensions, rappel image puis video
      (gif < jpeg < jpg < png < webp< mp4 < webm)

  A4. Normalisation : lowercase sur le nom ET l'extension
  A5. Les fichier de lien ne sont pas lus et seront ignore sans warning

BLOC B — SCAN & CACHE
  B1. Scan au démarrage + si cache absent
  B2. Endpoints : POST /api/rescan (admin) + script CLI node scripts/rescan.js
  B3. ROOT_DIR cassé : serveur démarre, page d'erreur APRÈS login
  B4. Cache et warnings séparés :
      - cache/scan.json      → données valides uniquement
      - logs/scan-warnings.log → fichiers ignorés (texte, écrasé à chaque scan)

BLOC C — API & MÉDIAS
  C1. Vérification path traversal à CHAQUE requête média
  C2. Cache-Control: private, max-age=3600
  C3. Range requests natifs (module fs + headers Content-Range)

BLOC D — UX LECTEUR
  D1. Onglets « Comics » / « Images » sur la page série
  D2. Vignette = première IMAGE du comics, placeholder SVG gris sinon,
      lazy-loading activé
  D3. Pas de navigation par clic sur les vidéos (clavier + boutons)
  D4. Fin de comics : overlay modal fermable sur la dernière page
  D5. Indicateur « X / N » en bas, près des boutons
  D6. Pas de plein écran en V1

BLOC E — AUTH & SÉCURITÉ
  E1. Session : 24 h
  E2. Rate limit /login : 5 tentatives / 15 min / IP, reset au login réussi
  E3. SESSION_SECRET dans .env, config.json non commité (généré au 1er démarrage)
  E4. Si le fichier .env n'existe pas le generer avec une clé aléatoire

BLOC F — QUALITÉ & LIVRABLES
  F1. Tests : unitaires + intégration + E2E (fail fast global)
  F2. Framework : node:test natif (Node 20+)
  F3. Licence : MIT
  F4. Wireframes ASCII inclus
  F5. Nom projet : media-player-v2

BLOC G — DÉTAILS AFFINÉS
  G1. Logs : texte pour scan-warnings, JSON Lines pour app.jsonl
  G2. tests/ avec root_tests/, séries serie_a, serie_b
  G3. Config absente → valeurs par défaut + génération + warning console
  G4. Retour overlay fin → page de la série


--------------------------------------------------------------------------------
§2 CONTRAT D'API
--------------------------------------------------------------------------------

Base URL : http://<host>:<PORT>
Toutes les routes /api/* et /media/* exigent une session valide (sauf /login).
Cookie : connect.sid (HttpOnly, SameSite=Strict, Secure si HTTPS)


--------------------------------------------------------------------------------
2.1 POST /login
--------------------------------------------------------------------------------
Auth      : non requise
Body      : application/x-www-form-urlencoded
            username=<string>&password=<string>
Réponse 200 (succès) :
  Set-Cookie: connect.sid=...; HttpOnly; SameSite=Strict
  Redirect 302 → /
Réponse 401 (identifiants invalides) :
  { "error": "invalid_credentials" }
Réponse 429 (rate limit dépassé) :
  { "error": "too_many_attempts", "retryAfterSeconds": 300 }
Notes :
  - Le compteur de rate limit est reset au login réussi.
  - Timing-safe : bcrypt.compare est utilisé systématiquement, même si
    l'utilisateur n'existe pas (comparaison avec un hash factice).


--------------------------------------------------------------------------------
2.2 POST /logout
--------------------------------------------------------------------------------
Auth      : requise
Réponse 200 : { "ok": true }
Effet     : détruit la session, efface le cookie.


--------------------------------------------------------------------------------
2.3 GET /api/series
--------------------------------------------------------------------------------
Auth      : requise
Réponse 200 :
  {
    "series": [
      { "name": "onepiece", "comicsCount": 12, "imgCount": 5 },
      { "name": "naruto",   "comicsCount": 8,  "imgCount": 3 }
    ]
  }
Réponse 500 (ROOT_DIR inaccessible) :
  { "error": "root_dir_unavailable", "message": "..." }


--------------------------------------------------------------------------------
2.4 GET /api/series/:serie
--------------------------------------------------------------------------------
Auth      : requise
Params    : serie (string, lowercase, [a-z0-9_-]+)
Réponse 200 :
  {
    "name": "onepiece",
    "comics": [
      { "name": "comics_a", "pageCount": 12, "cover": "comics_a-0001.png" },
      { "name": "comics_b", "pageCount": 5,  "cover": "comics_b-0001.png" }
    ],
    "img": [
      { "name": "cover_a", "pageCount": 1, "cover": "cover_a-0001.png" }
    ]
  }
Réponse 404 : { "error": "serie_not_found" }


--------------------------------------------------------------------------------
2.5 GET /api/series/:serie/:folder/:name
--------------------------------------------------------------------------------
Auth      : requise
Params    : serie  (string)
            folder (enum: "comics" | "img")
            name   (string, nom du comics sans extension ni numéro)
Réponse 200 :
  {
    "serie": "onepiece",
    "folder": "comics",
    "name": "comics_a",
    "pages": [
      { "file": "comics_a-0001.png", "type": "image", "num": 1 },
      { "file": "comics_a-0002.png", "type": "image", "num": 2 },
      { "file": "comics_a-0003.mp4", "type": "video", "num": 3 }
    ]
  }
Réponse 404 : { "error": "comics_not_found" }


--------------------------------------------------------------------------------
2.6 GET /media/:serie/:folder/:file
--------------------------------------------------------------------------------
Auth      : requise
Params    : serie  (string)
            folder (enum: "comics" | "img")
            file   (string, nom de fichier validé par la regex A1)
Headers   :
  - Accept-Ranges: bytes
  - Cache-Control: private, max-age=3600
  - Content-Type: <mime selon extension>
Réponse 200 : flux du fichier
Réponse 206 : Partial Content (si Range: bytes=X-Y présent)
Réponse 403 : { "error": "forbidden" }     (path traversal détecté)
Réponse 404 : { "error": "file_not_found" }
Notes :
  - Path traversal : resolvedPath doit commencer par ROOT_DIR + path.sep
  - Le fichier doit être dans /comics/ ou /img/ d'une série existante


--------------------------------------------------------------------------------
2.7 POST /api/rescan
--------------------------------------------------------------------------------
Auth      : requise + rôle admin
Réponse 200 :
  { "ok": true, "seriesCount": 2, "comicsCount": 20, "warnings": 3 }
Réponse 403 : { "error": "forbidden" }
Effet     : relance le scan complet, écrase cache/scan.json et
            logs/scan-warnings.log, puis recharge la structure en mémoire.


--------------------------------------------------------------------------------
§3 SCHÉMA DU CACHE (cache/scan.json)
--------------------------------------------------------------------------------

{
  "version": 1,
  "generatedAt": "2026-09-26T12:00:00.000Z",
  "rootDir": "/chemin/absolu/vers/racine",
  "series": {
    "onepiece": {
      "comics": [
        {
          "name": "comics_a",
          "pages": [
            { "file": "comics_a-0001.png", "type": "image", "num": 1, "ext": "png" },
            { "file": "comics_a-0002.mp4", "type": "video", "num": 2, "ext": "mp4" }
          ]
        }
      ],
      "img": [
        {
          "name": "cover_a",
          "pages": [
            { "file": "cover_a-0001.png", "type": "image", "num": 1, "ext": "png" }
          ]
        }
      ]
    }
  }
}

Règles :
  - version : entier, à incrémenter si le schéma change
  - generatedAt : ISO 8601 UTC
  - rootDir : chemin absolu résolu au moment du scan
  - Aucun warning dans ce fichier (voir logs/scan-warnings.log)


--------------------------------------------------------------------------------
§4 FORMAT DES LOGS
--------------------------------------------------------------------------------

4.1 logs/scan-warnings.log  (texte, écrasé à chaque scan)
--------------------------------------------------------------------------------
Format : <ISO8601> | <chemin_relatif_à_ROOT_DIR> | raison=<code>

Codes de raison normalisés :
  - nom_non_conforme         (regex A1 ne matche pas)
  - extension_non_supporte   (extension hors liste)
  - numero_invalide          (page absente ou mal formée)
  - fichier_illisible        (permission, etc.)
  - dossier_ignore           (sous-dossier non reconnu dans comics/img)

Exemple :
  2026-09-26T12:00:00.000Z | onepiece/comics/cover.png | raison=nom_non_conforme
  2026-09-26T12:00:00.000Z | naruto/img/notes.txt    | raison=extension_non_supporte


4.2 logs/app.jsonl  (JSON Lines, append)
--------------------------------------------------------------------------------
Format : une ligne = un objet JSON

Champs communs :
  { "ts": "<ISO8601>", "level": "info|warn|error", "event": "<code>", ... }

Événements émis :
  - server_start          { port, rootDir, cacheLoaded }
  - server_stop           { reason }
  - scan_start            { rootDir }
  - scan_end              { seriesCount, comicsCount, durationMs, warnings }
  - login_success         { username }
  - login_failure         { username, ip }
  - login_rate_limited    { ip }
  - media_served          { serie, folder, file, bytes, ranged }
  - path_traversal_blocked{ requested, ip }
  - root_dir_error        { message }
  - config_generated      { path }
  - env_generated         { path }
  - cache_missing         { expectedPath }
  - error                 { message, stack }

Exemple :
  {"ts":"2026-09-26T12:00:00.000Z","level":"info","event":"server_start","port":3000,"rootDir":"/media","cacheLoaded":true}


--------------------------------------------------------------------------------
§5 REGEX + TABLE D'EXEMPLES
--------------------------------------------------------------------------------

Regex : ^(?<name>.+)-(?<page>\d{4}|\d{6})\.(?<ext>png|jpe?g|webp|gif|mp4|webm)$
Normalisation : lowercase avant matching.

+----------------------------------------+--------+--------+--------+---------+
| Fichier                                | name   | page   | ext    | Valide  |
+----------------------------------------+--------+--------+--------+---------+
| comics_a-0001.png                      | comics_a | 1    | png    | ✅      |
| comics_a-0001.PNG                      | comics_a | 1    | png    | ✅ (A4) |
| Chap01-0001.jpg                        | chap01   | 1    | jpg    | ✅      |
| mon-comics-2-0042.webp                 | mon-comics-2 | 42 | webp   | ✅      |
| long_nom_de_serie-123456.mp4           | long_nom_de_serie | 123456 | mp4 | ✅ |
| cover.png                              | —      | —      | —      | ❌ A2   |
| comics_a-01.png                        | —      | —      | —      | ❌ A2   |
| comics_a-0001.tiff                     | —      | —      | —      | ❌ A2   |
| comics_a-0001                          | —      | —      | —      | ❌ A2   |
| comics_a_0001.png                      | —      | —      | —      | ❌ A2   |
| -0001.png                              | —      | —      | —      | ❌ A2   |
| comics_a-0001.png.bak                  | —      | —      | —      | ❌ A2   |
| comics_a-0001.mp4                      | comics_a | 1    | mp4    | ✅      |
| .hidden-0001.png                       | —      | —      | —      | ⚠️ voir note |
| comics_a-0000001.png                   | —      | —      | —      | ❌ A2   |
+----------------------------------------+--------+--------+--------+---------+

Note sur les fichiers cachés (préfixe ".") :
  - Ignorés systématiquement (raison: nom_non_conforme)
  - Décision implicite cohérente avec A2


Dédoublonnage image/vidéo au même numéro (A3) :
  Si comics_a-0001.png ET comics_a-0001.mp4 existent :
    - Une seule page conservée.
    - Extension prioritaire selon ordre alphabétique strict :
      gif < jpeg < jpg < mp4 < png < webm < webp
    - Dans cet exemple : "gif" < "mp4" < "png" → .mp4 gagne (mp4 < png)
    - L'autre fichier est loggé dans scan-warnings.log
      (raison=numero_invalide, note: doublon résolu en faveur de .mp4)


--------------------------------------------------------------------------------
§6 DIAGRAMMES DE SÉQUENCE
--------------------------------------------------------------------------------

6.1 LOGIN
--------------------------------------------------------------------------------
  Utilisateur    Navigateur     Serveur
      │              │              │
      │ POST /login  │              │
      │─────────────>│              │
      │              │ rate-limit?  │
      │              │─────────────>│
      │              │              │ bcrypt.compare()
      │              │              │
      │              │ 302 + cookie │
      │              │<─────────────│
      │              │ reset rate   │
      │              │ limit        │
      │              │              │
      │ GET /        │              │
      │─────────────>│              │
      │              │ session ok?  │
      │              │─────────────>│
      │              │  page séries │
      │              │<─────────────│
      │<─────────────│              │


6.2 SCAN AU DÉMARRAGE
--------------------------------------------------------------------------------
  Serveur        FS            Cache
     │            │              │
     │ start      │              │
     │───────────>│              │
     │            │ config.json? │
     │            │<────────────>│  (généré si absent)
     │            │ .env?        │
     │            │<────────────>│  (généré si absent)
     │            │              │
     │ scan(ROOT) │              │
     │───────────>│              │
     │            │ walk dirs    │
     │            │ parse names  │
     │            │<────────────>│
     │            │              │
     │ write cache│              │
     │───────────────────────────>│
     │ write warn │              │
     │───────────────────────────>│
     │            │              │
     │ listen(PORT)              │
     │            │              │


6.3 LECTURE D'UNE PAGE
--------------------------------------------------------------------------------
  Client         Serveur       FS
     │              │           │
     │ GET /media/… │           │
     │─────────────>│           │
     │              │ auth?     │
     │              │ session   │
     │              │ resolve   │
     │              │ path      │
     │              │ startsWith│
     │              │ ROOT?     │
     │              │──────────>│
     │              │ stream    │
     │              │<──────────│
     │ 200/206      │           │
     │<─────────────│           │


6.4 FIN DE COMICS
--------------------------------------------------------------------------------
  Client         Serveur
     │              │
     │ dernière page│
     │ user click   │
     │ "Suivant"    │
     │─────────────>│
     │              │ GET /api/series/S/C/NAME
     │              │ (déjà en cache client)
     │              │
     │              │ shuffle(autres comics même dossier)
     │              │ take 3
     │              │
     │ overlay fin  │
     │<─────────────│
     │              │
     │ click "Retour au menu"
     │─────────────>│
     │              │ redirect /series/S
     │<─────────────│


--------------------------------------------------------------------------------
§7 WIREFRAMES ASCII
--------------------------------------------------------------------------------

7.1 LOGIN
--------------------------------------------------------------------------------
  +--------------------------------------------------+
  |                                                  |
  |              MEDIA PLAYER V2                     |
  |                                                  |
  |         +----------------------------+           |
  |         | Utilisateur                |           |
  |         +----------------------------+           |
  |         |                            |           |
  |         +----------------------------+           |
  |         | Mot de passe          [👁] |           |
  |         +----------------------------+           |
  |                                                  |
  |              [   Se connecter   ]                |
  |                                                  |
  |         (message d'erreur éventuel)              |
  |                                                  |
  +--------------------------------------------------+


7.2 LISTE DES SÉRIES
--------------------------------------------------------------------------------
  +--------------------------------------------------+
  |  [Déconnexion]              MEDIA PLAYER V2      |
  +--------------------------------------------------+
  |                                                  |
  |  Séries disponibles                              |
  |                                                  |
  |  +--------------------------------------------+  |
  |  | [IMG] onepiece    12 comics · 5 images     |  |
  |  +--------------------------------------------+  |
  |  | [IMG] naruto       8 comics · 3 images     |  |
  |  +--------------------------------------------+  |
  |                                                  |
  +--------------------------------------------------+

  [IMG] = vignette de la première image du 1er comics de la série.


7.3 LISTE DES COMICS D'UNE SÉRIE
--------------------------------------------------------------------------------
  +--------------------------------------------------+
  |  [← Séries] [Déconnexion]     onepiece           |
  +--------------------------------------------------+
  |                                                  |
  |  [ Comics ]  [ Images ]    ← onglets             |
  |  ─────────                                       |
  |                                                  |
  |  +----------+  +----------+  +----------+        |
  |  | [IMG]    |  | [IMG]    |  | [IMG]    |        |
  |  | comics_a |  | comics_b |  | comics_c |        |
  |  | 12 pages |  |  5 pages |  |  8 pages |        |
  |  +----------+  +----------+  +----------+        |
  |                                                  |
  +--------------------------------------------------+


7.4 LECTEUR
--------------------------------------------------------------------------------
  +--------------------------------------------------+
  |  [← onepiece]                        [Déconn.]   |
  +--------------------------------------------------+
  |                                                  |
  |                                                  |
  |                                                  |
  |                                                  |
  |              [ PAGE COURANTE ]                   |
  |              (image ou vidéo)                    |
  |                                                  |
  |                                                  |
  |                                                  |
  +--------------------------------------------------+
  |   [◀ Précédent]      Page 3 / 12     [Suivant ▶] |
  +--------------------------------------------------+

  Zone cliquable (image uniquement) :
    - Moitié GAUCHE → page précédente si existe
    - Moitié DROITE → page suivante si existe
  Clavier : ← → Espace Échap
  Vidéo : pas de zone cliquable, contrôles natifs


7.5 OVERLAY FIN DE COMICS
--------------------------------------------------------------------------------
  +--------------------------------------------------+
  |                                                  |
  |  ┌────────────────────────────────────────────┐  |
  |  │  Fin de comics_a                          │  |
  |  │                                            │  |
  |  │  Découvrir d'autres comics :              │  |
  |  │                                            │  |
  |  │  +-------+ +-------+ +-------+            │  |
  |  │  | [IMG] | | [IMG] | | [IMG] |            │  |
  |  │  | c_b   | | c_c   | | c_d   |            │  |
  |  │  +-------+ +-------+ +-------+            │  |
  |  │                                            │  |
  |  │  [  Retour au menu  ]   [ Fermer ]         │  |
  |  └────────────────────────────────────────────┘  |
  |                                                  |
  +--------------------------------------------------+


--------------------------------------------------------------------------------
§8 ARBORESCENCE DU PROJET
--------------------------------------------------------------------------------

media-player-v2/
├── .env                          # généré au 1er démarrage (gitignored)
├── .env.example                  # modèle commité
├── .gitignore                    # solide (voir §13)
├── LICENSE                       # MIT
├── README.md
├── package.json
│
├── config/
│   ├── config.json               # généré au 1er démarrage (gitignored)
│   ├── config.example.json       # modèle commité
│   ├── users.json                # hashes bcrypt (gitignored)
│   └── users.example.json        # modèle commité
│
├── cache/                        # gitignored
│   └── scan.json                 # généré au scan
│
├── logs/                         # gitignored
│   ├── scan-warnings.log
│   └── app.jsonl
│
├── scripts/
│   ├── hash-password.js          # génère un hash bcrypt interactif
│   ├── rescan.js                 # scan CLI sans HTTP
│   └── init.js                   # génère .env + config.json si absents
│
├── src/
│   ├── server.js                 # point d'entrée
│   ├── app.js                    # Express app (testable)
│   ├── config.js                 # chargement + génération config
│   ├── logger.js                 # app.jsonl
│   ├── scanner.js                # scan + parsing + dédoublonnage
│   ├── cache.js                  # lecture/écriture cache/scan.json
│   ├── auth.js                   # sessions + bcrypt + middleware
│   ├── security.js               # path traversal, rate limit
│   ├── suggest.js                # algorithme §5 du V1
│   │
│   ├── routes/
│   │   ├── auth.js               # /login /logout
│   │   ├── api.js                # /api/series/* /api/rescan
│   │   └── media.js              # /media/* + Range requests
│   │
│   └── utils/
│       ├── parseFilename.js      # regex A1 + normalisation A4
│       ├── mime.js               # extension → Content-Type
│       └── svgPlaceholder.js     # placeholder vignette
│
├── public/
│   ├── index.html                # login
│   ├── series.html               # liste des séries
│   ├── serie.html                # liste comics/img d'une série
│   ├── reader.html               # lecteur
│   │
│   ├── css/
│   │   └── style.css
│   │
│   ├── js/
│   │   ├── api.js                # wrapper fetch
│   │   ├── series.js
│   │   ├── serie.js
│   │   ├── reader.js             # clavier + clic + overlay
│   │   └── lazy.js               # IntersectionObserver
│   │
│   └── img/
│       ├── favicon.ico
│       └── placeholder.svg
│
└── tests/
    ├── unit/
    │   ├── parseFilename.test.js
    │   ├── suggest.test.js
    │   ├── security.test.js
    │   └── cache.test.js
    │
    ├── integration/
    │   ├── auth.test.js
    │   ├── api.test.js
    │   └── media.test.js
    │
    ├── e2e/
    │   ├── login.spec.js
    │   ├── reader.spec.js
    │   └── end-of-comics.spec.js
    │
    └── fixtures/
        └── root_tests/
            ├── serie_a/
            │   ├── comics/
            │   │   ├── comics_a-0001.png
            │   │   ├── comics_a-0002.png
            │   │   ├── comics_a-0003.mp4
            │   │   └── comics_b-0001.png
            │   └── img/
            │       └── cover_a-0001.png
            └── serie_b/
                └── comics/
                    └── chap01-0001.png


--------------------------------------------------------------------------------
§9 PLAN DE TESTS
--------------------------------------------------------------------------------

Commande unique : npm test
Fail fast : si une étape échoue, les suivantes ne sont PAS lancées.

Ordre d'exécution :
  1. node --test tests/unit/
  2. node --test tests/integration/
  3. npx playwright test tests/e2e/

9.1 TESTS UNITAIRES
--------------------------------------------------------------------------------
parseFilename.test.js
  - ✅ Valide 4 chiffres
  - ✅ Valide 6 chiffres
  - ✅ Rejette extension inconnue
  - ✅ Rejette tiret manquant
  - ✅ Rejette underscore comme séparateur
  - ✅ Normalise lowercase sur nom + extension
  - ✅ Gère nom avec tirets multiples (dernier tiret = séparateur)
  - ✅ Rejette fichier caché
  - ✅ Rejette chaîne vide

suggest.test.js
  - ✅ Retourne 3 suggestions max
  - ✅ Exclut le comics courant
  - ✅ Ne traverse pas /comics/ ↔ /img/
  - ✅ Ne traverse pas entre séries
  - ✅ Retourne [] si seul comics
  - ✅ Retourne < 3 si moins de 3 autres
  - ✅ Distribution aléatoire (test statistique léger)

security.test.js
  - ✅ Rejette ../../
  - ✅ Rejette chemin absolu
  - ✅ Accepte chemin valide
  - ✅ Rejette symlink sortant (si applicable)

cache.test.js
  - ✅ Écriture puis lecture → identique
  - ✅ Version mismatch → rescan
  - ✅ Cache corrompu → rescan silencieux

9.2 TESTS D'INTÉGRATION (supertest)
--------------------------------------------------------------------------------
auth.test.js
  - ✅ GET / sans session → 302 vers /login
  - ✅ POST /login valide → 302 + cookie
  - ✅ POST /login invalide → 401
  - ✅ 5 échecs → 429
  - ✅ Login réussi reset le rate limit
  - ✅ POST /logout détruit la session

api.test.js
  - ✅ GET /api/series avec session → 200 + structure
  - ✅ GET /api/series/:serie → 200
  - ✅ GET /api/series/inexistante → 404
  - ✅ GET /api/series/:serie/comics/:name → 200
  - ✅ POST /api/rescan en reader → 403
  - ✅ POST /api/rescan en admin → 200

media.test.js
  - ✅ GET /media/valide → 200
  - ✅ Range: bytes=0-99 → 206 + Content-Range
  - ✅ Path traversal → 403
  - ✅ Fichier hors /comics/ ou /img/ → 404
  - ✅ Cache-Control présent

9.3 TESTS E2E (Playwright)
--------------------------------------------------------------------------------
login.spec.js
  - ✅ Accès racine sans session → login
  - ✅ Login valide → page séries
  - ✅ Login invalide → message erreur
  - ✅ Déconnexion → retour login

reader.spec.js
  - ✅ Clic flèche droite → page suivante
  - ✅ Clic flèche gauche → page précédente
  - ✅ Espace → page suivante
  - ✅ Échap → retour menu
  - ✅ Clic moitié droite → page suivante
  - ✅ Clic moitié gauche → page précédente
  - ✅ Indicateur « X / N » correct
  - ✅ Vidéo : clic ne change pas de page

end-of-comics.spec.js
  - ✅ Dernière page + Suivant → overlay
  - ✅ Overlay contient 3 suggestions (ou moins)
  - ✅ Suggestions ≠ comics courant
  - ✅ Bouton « Retour au menu » → page série
  - ✅ Bouton « Fermer » → overlay disparaît


--------------------------------------------------------------------------------
§10 MATRICE DE TRAÇABILITÉ
--------------------------------------------------------------------------------

+------+------------------------------------------+---------------------------+
| Exig | Description                              | Implémentation / Test     |
+------+------------------------------------------+---------------------------+
| M1   | Auth obligatoire                         | auth.js / auth.test.js    |
| M2   | Bcrypt                                   | auth.js / auth.test.js    |
| M3   | Session cookie                           | auth.js / auth.test.js    |
| M4   | Scan ROOT_DIR                            | scanner.js / cache.test   |
| M5   | Liste séries                             | api.js / api.test.js      |
| M6   | Liste comics série                       | api.js / api.test.js      |
| M7   | Lecteur page par page                    | reader.js / e2e reader    |
| M8   | Navigation clavier                       | reader.js / e2e reader    |
| M9   | Détection préfixe                        | parseFilename / unit      |
| M10  | Fin comics + 3 suggestions               | suggest.js / e2e fin      |
| M11  | Lazy-load + prefetch                     | lazy.js / e2e reader      |
| M12  | Responsive                               | style.css / manuel        |
| M13  | W3C + Wave                               | manuel                    |
| M14  | Sécurité (traversal, cookies)            | security.js / unit+integ  |
| S1   | Support vidéo                            | media.js / integ+e2e      |
| S2   | Cache JSON                               | cache.js / cache.test     |
| S3   | Plein écran                              | ❌ hors V1 (Q17)          |
| C1   | Couvertures                              | ✅ via /img/              |
| C2   | Branding minimal                         | favicon + title           |
+------+------------------------------------------+---------------------------+


--------------------------------------------------------------------------------
§11 CHECKLIST DE RECETTE (validation manuelle finale)
--------------------------------------------------------------------------------

AVANT MISE EN PRODUCTION
  [ ] .env présent avec SESSION_SECRET de 64+ hex
  [ ] config.json présent avec ROOT_DIR absolu
  [ ] config/users.json présent avec 2 hash bcrypt
  [ ] cache/scan.json généré
  [ ] logs/ existant et writable

FONCTIONNEL
  [ ] Accès anonyme → redirigé login
  [ ] Login reader OK
  [ ] Login admin OK
  [ ] Login invalide → message
  [ ] 5 échecs → blocage 15 min
  [ ] Liste séries OK
  [ ] Onglets Comics / Images OK
  [ ] Vignettes chargées
  [ ] Lecture image OK
  [ ] Lecture vidéo OK (avec seek)
  [ ] Navigation clavier complète
  [ ] Navigation clic moitié
  [ ] Indicateur page X/N correct
  [ ] Fin comics → overlay 3 suggestions
  [ ] Suggestions ≠ courant, même dossier, même série
  [ ] Bouton Retour au menu
  [ ] Bouton Fermer overlay
  [ ] Déconnexion

TECHNIQUE
  [ ] Range request vidéo → 206
  [ ] Path traversal → 403
  [ ] Cache-Control présent
  [ ] W3C HTML valide
  [ ] W3C CSS valide
  [ ] Wave sans erreur bloquante
  [ ] Responsive mobile (375px)
  [ ] Responsive desktop (1920px)
  [ ] npm test passe intégralement

SÉCURITÉ
  [ ] .env non commité
  [ ] config.json non commité
  [ ] users.json non commité
  [ ] Cookie HttpOnly + SameSite=Strict
  [ ] bcrypt coût ≥ 12


--------------------------------------------------------------------------------
§12 RISQUES ET POINTS D'ATTENTION
--------------------------------------------------------------------------------

R1. Performance scan
    Si ROOT_DIR contient > 10 000 fichiers, le scan peut être lent.
    → Mitigation : scan asynchrone + cache JSON.

R2. Vidéos lourdes
    Range requests obligatoires pour éviter de charger 500 Mo.
    → Vérifier Content-Range sur Chrome + Firefox + Safari iOS.

R3. Path traversal via symlinks
    Si ROOT_DIR contient des symlinks sortants, fs.realpath peut
    contourner la vérification.
    → Mitigation : fs.realpathSync sur le chemin résolu avant comparaison.

R4. Cache corrompu
    Si cache/scan.json est partiellement écrit (kill -9).
    → Mitigation : écriture atomique (tmp + rename).

R5. Rate limit derrière proxy
    Si reverse proxy, IP = 127.0.0.1 pour tout le monde.
    → Mitigation : trust proxy configurable (hors V1).

R6. Clavier dans <input>
    Échap dans un champ ne doit pas déclencher la sortie du lecteur.
    → Mitigation : ignorer les événements si target est input/textarea.

R7. Vidéo sur iOS Safari
    Autoplay + plein écran natif gèrent mal le clic moitié.
    → Déjà tranché en Q14 : pas de clic sur vidéo.

R8. Encodage des noms de fichiers
    Noms avec accents / espaces → URL encoding.
    → Mitigation : encodeURIComponent côté client, decodeURIComponent
      côté serveur AVANT validation regex.


--------------------------------------------------------------------------------
§13 ANNEXE
--------------------------------------------------------------------------------

13.1 .gitignore
--------------------------------------------------------------------------------
  # Secrets
  .env
  .env.*
  !.env.example

  # Config utilisateur
  config/config.json
  config/users.json

  # Données générées
  cache/
  logs/
  media/

  # Node
  node_modules/
  npm-debug.log*
  yarn-error.log*
  pnpm-debug.log*

  # Tests
  coverage/
  playwright-report/
  test-results/
  .playwright/

  # OS / IDE
  .DS_Store
  Thumbs.db
  .idea/
  .vscode/
  *.swp


13.2 .env.example
--------------------------------------------------------------------------------
  # Généré automatiquement au premier démarrage si absent.
  # Ne JAMAIS commiter le .env réel.
  SESSION_SECRET=CHANGE_ME_64_HEX_CHARS


13.3 config/config.example.json
--------------------------------------------------------------------------------
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
    "LOGIN_RATE_LIMIT": {
      "windowMinutes": 15,
      "maxAttempts": 5
    }
  }


13.4 config/users.example.json
--------------------------------------------------------------------------------
  {
    "reader": { "password_hash": "$2b$12$REMPLACER_PAR_HASH_BCRYPT" },
    "admin":  { "password_hash": "$2b$12$REMPLACER_PAR_HASH_BCRYPT" }
  }


13.5 package.json (extrait)
--------------------------------------------------------------------------------
  {
    "name": "media-player-v2",
    "version": "1.0.0",
    "license": "MIT",
    "engines": { "node": ">=20" },
    "scripts": {
      "start": "node src/server.js",
      "rescan": "node scripts/rescan.js",
      "hash-password": "node scripts/hash-password.js",
      "test": "node --test tests/unit/ && node --test tests/integration/ && npx playwright test tests/e2e/"
    },
    "dependencies": {
      "express": "^4.19.0",
      "express-session": "^1.18.0",
      "bcrypt": "^5.1.0",
      "express-rate-limit": "^7.2.0",
      "dotenv": "^16.4.0"
    },
    "devDependencies": {
      "supertest": "^7.0.0",
      "@playwright/test": "^1.44.0"
    }
  }


================================================================================
FIN DU DOCUMENT V2
================================================================================