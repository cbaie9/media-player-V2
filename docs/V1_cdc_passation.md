================================================================================
CAHIER DES CHARGES - LECTEUR WEB DE COMICS/MANGAS
Version : 1.0
Statut  : Passation pour implémentation
Public  : Agent IA développeur
================================================================================


--------------------------------------------------------------------------------
1. CONTEXTE ET OBJECTIFS
--------------------------------------------------------------------------------

Créer un site web auto-hébergé (LAN ou VPN privé) permettant à deux
utilisateurs authentifiés (rôles : reader, admin) de lire des comics/mangas
stockés sous forme de fichiers images ou vidéos organisés dans une
arborescence de dossiers.

Le site doit :
  - Découvrir automatiquement les comics à partir d'une arborescence de
    fichiers, sans base de données.
  - Permettre une lecture page par page simple et fluide.
  - Proposer, à la fin d'un comics, 3 suggestions aléatoires issues de la
    même série, ainsi qu'un bouton de retour au menu.

Le projet est personnel et open-source.
Aucune fonctionnalité sociale, aucune sauvegarde de progression, aucune
inscription. L'accès est strictement réservé à deux comptes prédéfinis.


--------------------------------------------------------------------------------
2. PERIMETRE FONCTIONNEL
--------------------------------------------------------------------------------

2.1 MUST HAVE (V1)

  M1  Authentification obligatoire (2 comptes : reader, admin).
      Aucun accès anonyme possible.
  M2  Mots de passe hashés avec bcrypt.
  M3  Session utilisateur gérée par cookie.
  M4  Scan d'un dossier racine configurable pour découvrir les séries et
      leurs comics.
  M5  Affichage de la liste des séries après login.
  M6  Affichage de la liste des comics d'une série.
  M7  Lecteur page par page (images et vidéos) avec bouton précédent /
      suivant.
  M8  Navigation clavier : flèches gauche/droite, espace, échap.
  M9  Détection automatique des comics par préfixe de fichier (voir §3).
  M10 Fin de comics -> encart avec 3 comics aléatoires de la même série
      + bouton "Retour au menu".
  M11 Lazy-loading des pages + préchargement de la page suivante.
  M12 Responsive mobile + desktop.
  M13 Respect des normes W3C (HTML/CSS valides) et bonne conformité Wave.
  M14 Sécurité : protection contre le path traversal, cookies sécurisés,
      HTTPS recommandé (HTTP toléré en LAN/VPN).

2.2 SHOULD HAVE

  S1  Support des vidéos (.mp4, .webm) via balise <video>, traitées
      exactement comme des comics.
  S2  Cache de scan dans un fichier JSON régénérable.
  S3  Mode plein écran pour le lecteur.

2.3 COULD HAVE

  C1  Affichage des couvertures (facultatif, dossier /img/).
  C2  Branding minimal (favicon, titre).

2.4 WON'T HAVE (V1)

  - Inscription ou création de compte.
  - Sauvegarde de progression de lecture.
  - Commentaires, notes, favoris, listes de lecture.
  - Back-office d'administration.
  - Recherche, filtres, tags.
  - Multi-langue structuré (FR/EN cohabitent sans distinction).
  - Support CBZ / CBR / PDF.


--------------------------------------------------------------------------------
3. ARBORESCENCE DES FICHIERS ET REGLES DE NOMMAGE
--------------------------------------------------------------------------------

3.1 STRUCTURE ATTENDUE

  Le site reçoit via un fichier de configuration un dossier racine.
  Chaque sous-dossier direct de la racine représente une SERIE (catégorie).

  Chaque série possède deux sous-dossiers utiles :

      /racine/
        /onepiece/
          /comics/
            comics_a-0001.png
            comics_a-0002.png
            comics_a-0003.png
            comics_b-0001.png
            comics_b-0002.png
          /img/
            cover_a-0001.png
            cover_a-0002.png
            art_b-0001.png
        /naruto/
          /comics/
            chap01-0001.png
            chap01-0002.png
          /img/
            ...

  IMPORTANT :
  - Le dossier /comics/ contient les comics.
  - Le dossier /img/ contient des "imagesets" (images ou vidéos).
  - Les images et les vidéos d'un même préfixe sont traitées ensemble,
    comme un seul et même comics (voir §3.4).

3.2 FORMAT DE NOMMAGE IMPOSE

  Format strict :  %nom%-%numero_page%.%extension%

  - Le séparateur entre %nom% et %numero_page% est STRICTEMENT le tiret "-".
  - Le numéro de page est sur 4 chiffres OU 6 chiffres
    (ex : "0001" ou "000001").
  - Le numéro de page est toujours zéro-padded.
  - Extensions acceptées :
        .png, .jpg, .jpeg, .webp, .gif, .mp4, .webm
  - Le %nom% ne doit pas contenir de tiret suivi de chiffres.
    En cas d'ambiguïté, on considère comme séparateur le DERNIER tiret
    suivi uniquement de chiffres et d'une extension valide.

3.3 DEFINITION D'UN COMICS

  Un COMICS = ensemble des fichiers partageant le même %nom% dans un
  même dossier.
  Les pages sont triées par numéro croissant.
  Le type (image ou vidéo) est déterminé par l'extension de chaque page.
  Un comics peut donc mélanger images et vidéos : chaque page est rendue
  avec le bon élément HTML (<img> ou <video>).

3.4 TRAITEMENT DES IMAGES (REGLE AJOUTEE)

  Les images sont traitées exactement comme des comics.
  Exemple :
        image_a-0001.png
        image_a-0002.png
  -> forment un seul comics nommé "image_a" avec 2 pages.

  Le dossier /img/ suit la même logique que /comics/, la seule différence
  concerne les suggestions (voir §5).

3.5 TYPES D'ENTREES ET SUGGESTIONS

  +-------------+---------------------------------+-------------------------+
  | Dossier     | Contenu                         | Suggestions autorisees  |
  +-------------+---------------------------------+-------------------------+
  | /comics/    | Comics (images + videos)        | Uniquement d'autres     |
  |             |                                 | comics de la MEME serie |
  +-------------+---------------------------------+-------------------------+
  | /img/       | Imagesets (images + videos)     | Uniquement d'autres     |
  |             |                                 | imagesets de la MEME    |
  |             |                                 | serie                   |
  +-------------+---------------------------------+-------------------------+

  REGLES STRICTES :
  - Un comics ne suggère JAMAIS un imageset, et inversement.
  - Aucune suggestion inter-séries (ex : onepiece ne suggère pas naruto).


--------------------------------------------------------------------------------
4. PARCOURS UTILISATEUR
--------------------------------------------------------------------------------

  [Login]
     |
     v
  [Liste des series]
     |
     v
  [Liste des comics de la serie]
     |
     v
  [Lecteur]
     |
     | (derniere page + clic "suivant" ou clic zone droite)
     v
  [Encart : 3 suggestions aleatoires + bouton "Retour au menu"]


  4.1 LOGIN
      - Formulaire identifiant + mot de passe.
      - Toute page non authentifiée redirige vers ce formulaire.
      - Aucune inscription.

  4.2 LISTE DES SERIES
      - Dossiers détectés à la racine.

  4.3 LISTE DES COMICS D'UNE SERIE
      - Comics détectés dans /comics/.
      - Idem pour /img/ si l'utilisateur choisit cette catégorie.

  4.4 LECTEUR
      - Affiche la page courante (image via <img>, vidéo via <video>).
      - Boutons visibles "Précédent" et "Suivant".
      - Indicateur "page X / N".
      - Navigation clavier :
            Fleche gauche  -> page precedente
            Fleche droite  -> page suivante
            Espace         -> page suivante
            Echap          -> retour au menu
      - Navigation par clic sur l'image (REGLE AJOUTEE) :
            Clic sur la MOITIE DROITE de l'image  -> page suivante (si existante)
            Clic sur la MOITIE GAUCHE de l'image  -> page precedente (si existante)
        Le clic ne doit pas déclencher de navigation si aucune page
        correspondante n'existe.

  4.5 FIN DE COMICS
      - Au clic sur "Suivant" depuis la dernière page (ou clic sur la
        moitié droite de la dernière page), affichage d'un encart.
      - L'encart contient :
            3 comics tirés aléatoirement dans le MEME DOSSIER que le comics
            lu, en EXCLUANT le comics en cours.
            Un bouton "Retour au menu".
      - Si moins de 3 autres comics sont disponibles, on affiche tous ceux
        qui existent (sans doublon).


--------------------------------------------------------------------------------
5. ALGORITHME DE SUGGESTION (FIN DE COMICS)
--------------------------------------------------------------------------------

  Entree  : comics courant C, dossier D (/comics/ ou /img/), serie S.
  Sortie  : liste de 3 comics (ou moins) du meme dossier D de la serie S.

  Etapes :
    1. Construire la liste L de tous les comics de D (serie S).
    2. Retirer C de L.
    3. Si L est vide : afficher uniquement le bouton "Retour au menu".
    4. Melanger L aleatoirement.
    5. Prendre les 3 premiers elements (ou tous si L < 3).

  Contrainte : aucune suggestion ne traverse la frontiere /comics/ <-> /img/.
  Contrainte : aucune suggestion ne traverse la frontiere entre series.


--------------------------------------------------------------------------------
6. ARCHITECTURE TECHNIQUE
--------------------------------------------------------------------------------

  6.1 STACK PROPOSEE (a ajuster par l'agent implementeur)

      Front  : HTML / CSS / JS vanilla (ou React / Vue si prefere)
      Back   : Node.js + Express  (alternative : Python Flask/FastAPI)
      Auth   : Sessions + cookie + bcrypt
      Stockage : systeme de fichiers uniquement, aucune base de donnees
      Cache  : fichier JSON regenere a la demande

  6.2 SCAN ET CACHE

      - Au demarrage (ou a la premiere requete), le serveur scanne le
        dossier racine.
      - Il construit une structure en memoire, du type :

        {
          "onepiece": {
            "comics": [
              {
                "name": "comics_a",
                "pages": [
                  { "file": "comics_a-0001.png", "type": "image" },
                  { "file": "comics_a-0002.mp4", "type": "video" }
                ]
              },
              ...
            ],
            "img": [
              { "name": "cover_a", "pages": [ ... ] },
              ...
            ]
          },
          "naruto": { ... }
        }

      - Ce resultat est mis en cache dans un fichier JSON pour eviter un
        rescan a chaque requete.
      - Un rescan manuel peut etre declenche (endpoint admin, script ou
        redemarrage du serveur).

  6.3 SECURITE

      - Mots de passe hashes avec bcrypt.
      - Cookies de session : HttpOnly + SameSite=Strict.
        (Secure=true si HTTPS actif)
      - Protection path traversal : toute requete de fichier est validee
        contre la racine configuree. Aucun fichier hors racine ne peut
        etre servi.
      - Aucune donnee utilisateur stockee hormis la session.
      - HTTPS recommande si expose hors LAN. HTTP accepte en LAN/VPN.
      - Le site n'est pas destine a etre expose publiquement : acces via
        LAN ou VPN prive.

  6.4 PERFORMANCE

      - Chargement des images a la demande (lazy-loading).
      - Prechargement de la page suivante (prefetch / preload).
      - Pas de chargement global de la serie.

  6.5 ACCESSIBILITE ET CONFORMITE

      - HTML semantique (<main>, <nav>, <article>, ...).
      - Attributs alt sur toutes les images.
      - Navigation clavier complete.
      - Contraste conforme WCAG AA.
      - Validation W3C HTML et CSS.
      - Test Wave sans erreur bloquante.

  6.6 RESPONSIVE

      - Le site doit fonctionner sur mobile et desktop.
      - Le lecteur doit s'adapter a la taille de l'ecran.
      - Les zones cliquables (gauche / droite) doivent rester utilisables
        au doigt sur mobile.


--------------------------------------------------------------------------------
7. COMPTES ET ROLES
--------------------------------------------------------------------------------

  +----------+--------------------------------------------------------+
  | Role     | Acces                                                  |
  +----------+--------------------------------------------------------+
  | reader   | Lecture de toutes les series, comics et imagesets      |
  | admin    | Identique a reader en V1                               |
  |          | (prepare pour futures fonctionnalites)                 |
  +----------+--------------------------------------------------------+

  - 2 comptes fixes, definis dans un fichier de configuration.
  - Aucune inscription possible.
  - Aucune gestion utilisateur en V1.


--------------------------------------------------------------------------------
8. CONFIGURATION
--------------------------------------------------------------------------------

  Fichier de configuration attendu (ex : config.json ou .env) :

      ROOT_DIR=/chemin/vers/racine
      USERS_FILE=./users.json
      SESSION_SECRET=<chaine aleatoire longue>
      PORT=3000

  Fichier users.json :

      {
        "reader": { "password_hash": "$2b$..." },
        "admin":  { "password_hash": "$2b$..." }
      }

  Un script doit etre fourni pour generer les hash bcrypt.


--------------------------------------------------------------------------------
9. LIVRABLES
--------------------------------------------------------------------------------

  - Code source complet (depot Git).
  - README.md : installation, configuration, lancement.
  - Fichier de configuration exemple.
  - Script de generation des hash bcrypt.
  - Licence open-source (MIT ou GPL, a choisir).


--------------------------------------------------------------------------------
10. HORS PERIMETRE EXPLICITE (V1)
--------------------------------------------------------------------------------

  - Sauvegarde de progression de lecture.
  - Multi-utilisateurs au-dela des 2 comptes.
  - Fonctionnalites sociales.
  - Back-office.
  - Recherche / tags / filtres.
  - Support CBZ / CBR / PDF.
  - Internationalisation structuree.


--------------------------------------------------------------------------------
11. EVOLUTIONS ENVISAGEES (POST-V1)
--------------------------------------------------------------------------------

  - Back-office admin (upload, edition, suppression).
  - Sauvegarde de progression.
  - Recherche et tags.
  - Support archives .cbz / .cbr.
  - Statistiques de lecture.


--------------------------------------------------------------------------------
12. RECAPITULATIF DES CHOIX VALIDES
--------------------------------------------------------------------------------

  - Format de nommage : %nom%-%numero_page%.%extension%
    (4 ou 6 chiffres zero-padded).
  - Prefixe = nom avant le dernier tiret suivi de chiffres.
  - Images et videos d'un meme prefixe = un seul comics (meme si
    extensions differentes).
  - Les images sont traitees exactement comme des comics.
  - Suggestions en fin de comics : 3 aleatoires, MEME dossier uniquement,
    jamais entre comics et imagesets, jamais entre series.
  - Fin de comics : encart + bouton retour menu.
  - Clic sur moitie droite de l'image = page suivante (si existante).
  - Clic sur moitie gauche de l'image = page precedente (si existante).
  - Auth : 2 comptes, bcrypt, cookies, pas d'inscription.
  - Pas de progression sauvegardee.
  - Cache de scan JSON.
  - Mobile + desktop, W3C + Wave.
  - LAN / VPN prive, HTTP acceptable.


================================================================================
FIN DU CAHIER DES CHARGES
================================================================================