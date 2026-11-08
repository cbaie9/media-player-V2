================================================================================
MINI CAHIER DES CHARGES — MEDIA PLAYER V2
Support des formats image modernes (.jxl, .avif)
================================================================================
Version  : 1.5.2
Date     : 2026-11-08
Base     : V1.5.1 (docs/CDC_V1.5.1_scrapper_dest.md)
Statut   : Verrouillé
Public   : Développeur / mainteneur
================================================================================


1. OBJECTIF
--------------------------------------------------------------------------------

Ajouter le support de deux formats image modernes à la médiathèque, en
complément des formats déjà supportés (.png .jpg .jpeg .webp .gif .mp4 .webm) :

  - .jxl  (JPEG XL)  — compression lossless 30 à 50 % plus efficace que PNG
  - .avif (AVIF)     — compression lossy/lossless meilleure que WebP et JPEG

Motivations :
  - réduction significative du poids des images
  - décodage rapide côté navigateur (comparable au JPEG)
  - support natif navigateur mature en novembre 2026 :
    * .jxl  : Chrome 155+, Firefox 158+, Safari 17+
    * .avif : Chrome 85+,  Firefox 93+,  Safari 16.4+

Aucune régression fonctionnelle : tous les formats existants continuent
d'être supportés sans changement de comportement.


2. PÉRIMÈTRE
--------------------------------------------------------------------------------

2.1 Formats ajoutés

  .jxl  → type image, MIME image/jxl
  .avif → type image, MIME image/avif

  Les deux formats se comportent EXACTEMENT comme un .png :
    - même mécanisme de nommage (%nom%-%numero_page%.%extension%)
    - même regroupement par %nom%
    - même tri par numéro de page
    - même génération de vignette
    - même pipeline de lecture (classic + manwa)

2.2 Regex de parsing des noms de fichiers

  Regex AVANT :
    ^(?<name>.+)-(?<page>\d{4}|\d{6})\.(?<ext>png|jpe?g|webp|gif|mp4|webm)$

  Regex APRÈS :
    ^(?<name>.+)-(?<page>\d{4}|\d{6})\.(?<ext>png|jpe?g|webp|gif|mp4|webm|jxl|avif)$

  Aucune autre règle de nommage ne change (séparateur tiret, 4 ou 6
  chiffres, zéro-padding).

2.3 Types MIME

  Mappings à déclarer au démarrage du serveur :
    image/jxl  -> .jxl
    image/avif -> .avif

  Selon la version d'Express :
    - Express 4 : express.static.mime.define({
                    'image/jxl':  ['jxl'],
                    'image/avif': ['avif'],
                  })
    - Express 5 : require('mime').define({
                    'image/jxl':  ['jxl'],
                    'image/avif': ['avif'],
                  })

  Note : `image/avif` est déjà présent dans mime-db depuis 2020, il est
  donc très probablement déjà reconnu par la version de `mime` embarquée.
  La déclaration explicite est un filet de sécurité si la version de
  mime est ancienne. `image/jxl` est plus récent dans mime-db : la
  déclaration explicite est fortement recommandée.

  Le mapping doit être appliqué AVANT le montage de :
    - express.static(PROJECT_ROOT/public)
    - buildMediaRouter(...)
  pour que les deux servent le bon Content-Type.

2.4 Lecteur (classic et manwa)

  Aucune modification :
    - reader.js : <img src="..."> gère nativement le décodage .jxl/.avif
    - manwa.js : idem
    - api.mediaUrl(...) : inchangé

  Les images suivent le même pipeline que les .png (lazy loading,
  virtualisation native, placeholder SVG en cas d'échec).

2.5 Vignettes

  Les vignettes utilisent la même logique qu'aujourd'hui : première image
  du comics (peu importe son extension). Une vignette .jxl ou .avif sera
  rendue nativement par le navigateur. Aucun changement dans thumb.js.


3. FICHIERS IMPACTÉS
--------------------------------------------------------------------------------

  src/utils/parseFilename.js     | modif : regex + liste extensions
  src/utils/mime.js              | modif : mappings .jxl + .avif
  src/app.js                     | modif : enregistrement des mappings
                                 |         MIME au démarrage
  src/server.js (si applicable)  | modif : idem si le mapping est
                                 |         déclaré ici plutôt que dans app.js
  README.md                      | modif : section "Structure des médias"
                                 |         + changelog V1.5.2
  docs/USAGE.md                  | modif : extensions supportées
  docs/INSTALL.md                | modif : extensions supportées (§5)
  docs/CDC_V1.5.2_formats_image.txt | création : ce document

  NON IMPACTÉS :
    - src/scanner.js (utilise parseFilename, aucune modif directe)
    - src/store.js
    - src/cache.js (cache reste version 3)
    - src/suggest.js
    - src/routes/api.js
    - src/routes/media.js (utilise le MIME global)
    - src/scrapper/* (sans rapport avec les extensions image)
    - public/js/* (reader.js, manwa.js, thumb.js, lazy.js...)
    - protected/* et public/css/*
    - tests existants (aucun test ne casse, ajout de tests uniquement)


4. SÉCURITÉ
--------------------------------------------------------------------------------

  - Les formats .jxl et .avif ne changent AUCUNE règle de sécurité.
  - La validation des noms de fichiers reste identique (regex A1 étendue).
  - La protection path traversal (fs.realpathSync + startsWith) reste
    appliquée sur chaque requête média, tous formats inclus.
  - Le filtrage admin-only reste inchangé (les fichiers .jxl/.avif
    peuvent être dans comics/ ou comics_admin/, comme tout autre format).
  - Aucune nouvelle surface d'attaque : le décodage .jxl/.avif est fait
    par le navigateur, pas par le serveur.
  - Si un navigateur ne supporte pas un format, l'image s'affiche cassée
    (placeholder SVG existant côté client). Pas de fallback côté serveur
    en V1.5.2 (voir §6 Hors périmètre).


5. TESTS
--------------------------------------------------------------------------------

5.1 Tests unitaires (tests/unit/parseFilename.test.js)

  Ajouts pour .jxl :
    ✅ Accepte "comics_a-0001.jxl"
    ✅ Accepte "comics_a-000001.jxl"
    ✅ Accepte "Comics_A-0001.JXL" (normalisation lowercase)
    ✅ Accepte "mon-comics-2-0042.jxl"
    ✅ Rejette "comics_a-0001.jxl.bak"
    ✅ Rejette "comics_a.jxl" (pas de numéro de page)
    ✅ Retourne { name, page, ext: 'jxl', type: 'image' }

  Ajouts pour .avif :
    ✅ Accepte "comics_a-0001.avif"
    ✅ Accepte "comics_a-000001.avif"
    ✅ Accepte "Comics_A-0001.AVIF" (normalisation lowercase)
    ✅ Accepte "mon-comics-2-0042.avif"
    ✅ Rejette "comics_a-0001.avif.bak"
    ✅ Rejette "comics_a.avif" (pas de numéro de page)
    ✅ Retourne { name, page, ext: 'avif', type: 'image' }

5.2 Tests d'intégration (tests/integration/media.test.js)

  Ajouts (identiques pour .jxl et .avif) :
    ✅ GET /media/:serie/comics/:name.jxl  renvoie 200
    ✅ GET /media/:serie/comics/:name.avif renvoie 200
    ✅ Content-Type de la réponse contient "image/jxl" pour .jxl
    ✅ Content-Type de la réponse contient "image/avif" pour .avif
    ✅ Range request sur .jxl/.avif renvoie 206 + Content-Range
    ✅ Path traversal sur .jxl/.avif renvoie 403
    ✅ .jxl/.avif dans comics_admin/ invisible pour reader (404)

5.3 Tests E2E (tests/e2e/reader.spec.js et manwa.spec.js)

  Ajouts (si fixtures .jxl/.avif disponibles) :
    ✅ Une image .jxl s'affiche dans le lecteur classic
    ✅ Une image .avif s'affiche dans le lecteur classic
    ✅ Une image .jxl s'affiche dans le lecteur manwa
    ✅ Une image .avif s'affiche dans le lecteur manwa

  Note : un fichier .jxl de fixture valide doit être généré via cjxl
  (outil libjxl), et un fichier .avif via avifenc (outil libavif), ou
  fournis pré-convertis dans tests/fixtures/assets/.

5.4 Non-régression

  - Tous les tests existants (unit, integration, E2E) doivent passer
    sans modification (sauf ajouts).
  - Aucun test existant ne teste une regex stricte qui exclurait
    explicitement .jxl ou .avif → vérification à faire au moment de
    l'implémentation.


6. HORS PÉRIMÈTRE (explicite)
--------------------------------------------------------------------------------

6.1 Formats NON supportés en V1.5.2 (volontaire)

  ❌ .heic (HEIF / High Efficiency Image Format — format Apple)
       Raison : support navigateur insuffisant. Safari décode nativement,
                mais Chrome et Firefox NON. Un ajout à la regex ne
                suffirait PAS : il faudrait soit :
                  - une conversion serveur (sharp + libheif) avant envoi
                  - un polyfill client (libheif-js, ~5 Mo WASM)
                  - une version alternative .jpg fournie manuellement
                Ce chantier est lourd et hors du même ordre de grandeur
                que .jxl/.avif. À traiter dans un ticket séparé
                (V1.6.x ou V1.7).

  ❌ .jp2 (JPEG 2000)
       Raison : aucun navigateur moderne ne le décode nativement.
                Idem .heic : nécessiterait OpenJPEG.js (WASM ~2 Mo)
                ou une conversion serveur via sharp.
                À traiter dans un ticket séparé (V1.6.x ou V1.7).

6.2 Autres exclusions

  ❌ Fallback côté serveur : si un navigateur ne supporte pas .jxl ou
       .avif, le fichier n'est PAS converti automatiquement en .png/.webp.
       Une version dégradée doit être fournie manuellement dans la
       médiathèque si nécessaire (ex : comics_a-0001.png à côté de
       comics_a-0001.jxl).

  ❌ Élément <picture> / srcset avec négociation de type : le site
       utilise <img src="..."> direct. Aucune détection côté client
       n'est implémentée en V1.5.2.

  ❌ Conversion automatique des images existantes : c'est une décision
       utilisateur (via cjxl pour .jxl, avifenc pour .avif, hors site).

  ❌ Prévisualisation côté serveur (miniature générée) : la vignette
       utilise le fichier brut, décodé par le navigateur.

  ❌ Support de .heic, .jp2, .jp2/.jpf/.jpx : voir §6.1.

  ❌ Interface d'upload ou de conversion intégrée.


7. COMPATIBILITÉ ET RISQUES
--------------------------------------------------------------------------------

  R1. Support navigateur
      - .jxl  : Chrome 155+ (oct 2026), Firefox 158+ (oct 2026),
                Safari 17+ (2023)
      - .avif : Chrome 85+, Firefox 93+, Safari 16.4+ (2023)
      - Navigateurs plus anciens : image cassée (placeholder SVG)
      - Mitigation : documentation claire dans USAGE.md avec les
        versions minimales requises pour chaque format.

  R2. Taille des fichiers
      - Aucun risque : le serveur sert le fichier tel quel.
      - Range requests supportés comme pour les autres formats.

  R3. Vignettes
      - Une vignette .jxl ou .avif peut être lourde à décoder côté
        navigateur si l'image est très grande.
      - Mitigation : comportement identique à un .png de même taille.

  R4. Cache
      - Aucun impact : le cache de scan reste version 3.
      - Un rescan est nécessaire après ajout de fichiers .jxl/.avif
        (comportement existant).

  R5. Différence de support entre .jxl et .avif
      - .avif est supporté depuis plus longtemps (2023 pour Safari).
      - .jxl est supporté depuis 2026 sur Chrome/Firefox.
      - Sur des navigateurs très anciens, .jxl cassera avant .avif.
      - Mitigation : documenter dans USAGE.md, recommander un navigateur
        à jour pour un usage LAN/VPN.


8. DOCUMENTATION À METTRE À JOUR
--------------------------------------------------------------------------------

  README.md :
    - Section "Structure des médias" → ajouter .jxl et .avif à la liste
      des extensions.
    - Changelog → nouvelle entrée V1.5.2 en tête.

  docs/USAGE.md :
    - Tableau des extensions supportées (avec .jxl et .avif).
    - Note sur la compatibilité navigateur (versions minimales pour
      chaque format).

  docs/INSTALL.md :
    - §5 "Préparation de la médiathèque" : ajouter .jxl et .avif aux
      extensions acceptées.
    - Note optionnelle : convertir via cjxl (JPEG XL) ou avifenc (AVIF)
      si souhaité.

  docs/SECURITY.md :
    - Aucune modification nécessaire (pas de nouvelle surface).


9. CRITÈRES D'ACCEPTATION
--------------------------------------------------------------------------------

  ✅ Un fichier "comics_a-0001.jxl" placé dans comics/ est détecté au
     scan et apparaît dans la liste des comics.
  ✅ Un fichier "comics_a-0001.avif" idem.
  ✅ Les deux sont lisibles dans le lecteur classic.
  ✅ Les deux sont lisibles dans le lecteur manwa.
  ✅ Les deux sont servis avec le bon Content-Type (image/jxl,
     image/avif).
  ✅ Ils sont filtrables admin-only (placés dans comics_admin/) sans
     fuite côté reader.
  ✅ Tous les tests existants passent.
  ✅ Les nouveaux tests (parseFilename, media, E2E) passent.
  ✅ Aucune régression sur .png, .jpg, .jpeg, .webp, .gif, .mp4, .webm.
  ✅ Un fichier .heic ou .jp2 placé dans la médiathèque est rejeté au
     scan avec un warning (raison=extension_non_supporte), comme
     aujourd'hui.


10. ESTIMATION
--------------------------------------------------------------------------------

  Charge : faible (3 à 4 heures développement + tests, .avif étant
           quasi gratuit une fois .jxl intégré)
  Risque : très faible (extension d'une liste existante + mappings MIME)
  Dépendance externe : aucune (pas de lib à installer côté serveur)
  Impact perf : positif (images plus petites, décodage plus rapide)


11. ÉVOLUTIONS FUTURES (hors V1.5.2)
--------------------------------------------------------------------------------

  - V1.6.x / V1.7 : support de .heic (avec polyfill client libheif-js
    ou conversion serveur via sharp).
  - V1.6.x / V1.7 : support de .jp2 (avec polyfill client OpenJPEG.js
    ou conversion serveur via sharp).
  - V1.6.x / V1.7 : génération de vignettes côté serveur (sharp) pour
    éviter de charger l'image originale en vignette.
  - V1.6.x / V1.7 : négociation de contenu avec <picture> + srcset
    pour fallback automatique vers .png/.jpg.
  - V1.6.x / V1.7 : outil de conversion intégré (cjxl / avifenc
    wrappés dans un endpoint admin).


================================================================================
FIN DU MINI-CDC V1.5.2
================================================================================