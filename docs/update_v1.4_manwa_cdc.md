CAHIER DES CHARGES — LECTEUR MANWA (v3)

Projet : media-player-V2
Objet : Ajout d'un second mode de lecture « Manwa » (scroll vertical continu), d'un toggle entre les deux lecteurs, et synchronisation des positions.
Version : 1.0
Statut : À valider

CONTEXTE ET OBJECTIFS

Le lecteur actuel (reader) affiche une page à la fois (image ou vidéo) avec navigation par boutons, clic sur les moitiés gauche/droite ou flèches clavier. Pour les comics/manwa, ce mode est moins adapté qu'un défilement vertical continu.

Cette mise à jour ajoute :

Un lecteur Manwa : liste verticale d'images/vidéos les unes sous les autres, dans une liste non ordonnée (ul).

Un toggle pour basculer entre les deux lecteurs, accessible dans les deux sens.

Une synchronisation de position entre les deux modes (via IDs de page).

Un lazy loading optimisé (chargement à la demande, marge d'une vue).

Un scrollspy de fin déclenchant l'overlay de fin existant.

Un cookie mémorisant le mode choisi (par défaut : classic).

Aucune modification de l'API ni du backend n'est nécessaire.

PÉRIMÈTRE

Inclus :

Nouveau mode de lecture Manwa.

Toggle entre les deux modes.

Lazy loading, virtualisation, scrollspy de fin.

Synchronisation de position et de lecture vidéo.

Tests E2E, performance et accessibilité dédiés.

Séparation stricte des fichiers (manwa.js, manwa.css).

Exclu :

Modifications backend / API.

Refonte du lecteur classique (hors ajout du système d'IDs).

Nouveau système de suggestions de fin (réutilisation de l'existant).

Partage d'URL du mode (?mode=manwa) → le cookie suffit.

SPÉCIFICATIONS FONCTIONNELLES

3.1 Lecteur Manwa

Le lecteur Manwa affiche les pages dans une liste non ordonnée (ul id="manwa-list").

Chaque page est un li class="manwa-item" id="page-XXXXXX" (padding 6 chiffres, ex. page-000042).

Chaque li contient :

une img pour les pages de type image,

une video controls preload="metadata" pour les pages de type vidéo.

Les images et vidéos sont en pleine largeur, empilées verticalement, sans espace entre elles (line-height: 0 sur le li).

Largeur maximale de lecture : 800px centré sur desktop, 100% sur mobile.

3.2 Toggle entre lecteurs

Emplacement : topbar, en dark mode, dans le HTML (pas d'injection JS).

Comportement :

Un clic masque le lecteur actif et affiche l'autre.

Le libellé du bouton reflète l'action (« Passer en mode Manwa » / « Passer en mode Classique »).

aria-pressed reflète l'état (true = Manwa).

Persistance : cookie reader_mode (classic | manwa), lu en priorité au chargement.

Script inline en head pour appliquer le mode avant le premier rendu (évite le flash). Le script ajoute une classe manwa-mode sur html si le cookie vaut manwa.

Cas particuliers :

Si le comics ne contient aucune image (que des vidéos), le toggle est masqué et le mode reste classic.

Si le comics n'a pas de pages (cas impossible par le scan), retour au menu série.

3.3 Lazy loading

Mécanisme : IntersectionObserver observant chaque li, avec root = conteneur scrollable Manwa, rootMargin: '100% 0px 100% 0px' (une hauteur de viewport au-dessus et en dessous).

Comportement :

À l'intersection, on affecte img.src = img.dataset.src puis on unobserve l'item.

loading="lazy" natif désactivé (redondant et moins prévisible).

Les vidéos suivent le même mécanisme : leur src est affecté à l'entrée dans la zone, puis preload="metadata".

Marge : une hauteur de viewport ≈ 1 à 2 images en avance selon la taille des pages. Ce réglage est centralisé dans une constante (MANWA_ROOT_MARGIN) pour ajustement.

Placeholder de chargement : réutilisation du placeholder existant de la page série.

Échec de chargement : placeholder SVG avec une croix (fichier assets/img/broken.svg).

3.4 Scrollspy de fin

Sentinelle : élément div id="manwa-end-sentinel" placé après le /ul, dans le conteneur scrollable.

Déclenchement : IntersectionObserver sur la sentinelle → affiche l'overlay de fin existant (showEndOverlay).

Ré-affichage : à chaque retour en bas du comics, l'overlay se réaffiche (comportement identique au lecteur classique).

Overlay :

position: fixed, au-dessus du flux.

Fermable via le bouton existant.

Après fermeture, le scroll redevient actif.

Ajout d'un texte aria-live="polite" : « Fin du comics ».

Cas comics à 1 page : l'overlay ne s'affiche pas automatiquement. Il faut une interaction utilisateur (scroll vers le bas ou flèche bas) pour le déclencher.

Cas comics à 0 page : impossible (non listé par le scan).

3.5 Synchronisation des positions

Classic → Manwa :

Lecture de state.index (page courante).

document.getElementById('page-' + pad6(index)).scrollIntoView({ behavior: 'instant', block: 'start' }).

Manwa → Classic :

Un second IntersectionObserver avec rootMargin: '-50% 0px -50% 0px' (threshold 0) détermine l'item dont la bounding box coupe le centre du viewport.

Cet item devient l'item actif ; state.index est mis à jour en continu pendant le scroll Manwa (pas seulement au toggle).

Au basculement Manwa → Classic, le lecteur classique s'ouvre sur state.index.

Vidéos :

Le currentTime d'une vidéo en cours est sauvegardé au moment du toggle et restauré lors du basculement inverse (si la page active est la même vidéo).

Cache partagé :

Les deux lecteurs utilisent les mêmes URLs (api.mediaUrl(...)), donc le cache HTTP du navigateur est naturellement partagé. Aucun re-téléchargement lors d'un aller-retour Classic ↔ Manwa.

3.6 Vidéos dans Manwa

video controls preload="metadata" en pleine largeur.

Lazy loading appliqué (le src est affecté à l'entrée dans la zone).

Pas de bascule automatique vers le mode Classic.

Une vidéo en lecture n'empêche pas le scrollspy de fin de fonctionner (l'utilisateur doit scroller pour déclencher la sentinelle).

3.7 Virtualisation

Stratégie : virtualisation native du navigateur via content-visibility: auto sur chaque li + contain-intrinsic-size: 800px 1200px (estimation des dimensions).

Les li sont tous créés dans le DOM (jusqu'à 500+ pages), mais le navigateur n'en rend que ceux proches du viewport.

Le lazy loading s'occupe de ne charger que les médias nécessaires.

Si un profilage montre que content-visibility est insuffisant (ex. DOM trop lourd à la création), une phase 2 pourra ajouter un virtualiseur JS (création/destruction d'img à la volée). Non requis en v1.

3.8 Accessibilité (WCAG AA)

ul role="list" explicite (car list-style: none peut faire perdre la sémantique).

li tabindex="0" pour la navigation clavier, en conservant le scroll natif (flèches, Page Down) et le scroll tactile mobile.

alt des images : identique au lecteur classique.

aria-live="polite" sur le message « Fin du comics ».

aria-pressed sur le bouton toggle.

Couleurs : reprise stricte du CSS existant (placeholders, fond, texte).

SPÉCIFICATIONS TECHNIQUES

4.1 Architecture et fichiers

Fichier Rôle
public/reader.html Structure HTML : conteneur Classic, conteneur Manwa, bouton toggle, script inline cookie
public/js/reader.js Lecteur classique (ajout du système d'IDs page-XXXXXX)
public/js/manwa.js Nouveau — lecteur Manwa (liste, lazy loading, scrollspy, sync)
public/css/reader.css Styles du lecteur classique (inchangés sauf IDs)
public/css/manwa.css Nouveau — styles Manwa (classes préfixées manwa-)
public/assets/img/broken.svg Nouveau — placeholder d'échec de chargement
tests/e2e/manwa.spec.js Nouveau — tests dédiés
tests/e2e/fixtures/comics-many/ Nouveau — comics de test avec ~20 pages
tests/e2e/fixtures/comics-single/ Nouveau — comics de test à 1 page

4.2 Conventions

IDs de page : page- + index sur 6 chiffres (page-000001 à page-999999).

Classes CSS : toutes les classes du mode Manwa sont préfixées manwa- (ex. manwa-item, manwa-list, manwa-container). Aucune collision avec les classes du lecteur classique.

Cookie :

Nom : reader_mode

Valeurs : classic | manwa

Durée : persistant, 1 an (Max-Age=31536000)

Scope : path=/

Attributs : SameSite=Lax, Secure en prod

Lecture/écriture : côté client uniquement (script inline + JS du toggle)

Module JS : manwa.js est un module ES importé par reader.html (script type="module"), avec import { mediaUrl } from './api.js' ou équivalent du projet.

4.3 Conteneur scrollable (décision A3)

Le lecteur Manwa utilise un conteneur scrollable dédié :

<main id="manwa-reader" class="manwa-container" hidden> <ul id="manwa-list" class="manwa-list" role="list"></ul> <div id="manwa-end-sentinel" class="manwa-end-sentinel" aria-hidden="true"></div> </main>
.manwa-container {
height: calc(100vh - var(--topbar-height));
overflow-y: auto;
overscroll-behavior: contain;
}

Justification :

Isole le scroll entre les deux lecteurs (pas de fuite de position).

root de l'IntersectionObserver explicite → comportement stable.

La topbar reste fixe.

Meilleure gestion mobile (pas de double scroll).

content-visibility: auto fonctionne bien sur les enfants d'un conteneur scrollable.

4.4 Lazy loading — solution retenue (décision B2)

const MANWA_ROOT_MARGIN = '100% 0px 100% 0px'; // ≈ 1 vue de marge

const observer = new IntersectionObserver((entries) => {
for (const entry of entries) {
if (!entry.isIntersecting) continue;
const media = entry.target.querySelector('[data-src]');
if (media) {
media.src = media.dataset.src;
media.removeAttribute('data-src');
}
observer.unobserve(entry.target);
}
}, {
root: document.getElementById('manwa-reader'),
rootMargin: MANWA_ROOT_MARGIN,
threshold: 0,
});

document.querySelectorAll('.manwa-item').forEach(li => observer.observe(li));

Justification :

100% de marge = une hauteur de viewport, soit environ 1 à 2 images en avance selon la taille des pages.

Pas de chargement inutile (contrairement à un rootMargin fixe de 3600px qui chargerait 3+ images même sur petits écrans).

unobserve après chargement : chaque image n'est chargée qu'une fois.

Le cache HTTP navigateur prend le relais pour les rechargements éventuels.

4.5 Scrollspy de fin

const endObserver = new IntersectionObserver((entries) => {
if (entries[0].isIntersecting) {
showEndOverlay();
}
}, { root: document.getElementById('manwa-reader'), threshold: 0.1 });

endObserver.observe(document.getElementById('manwa-end-sentinel'));

unobserve non appelé : l'overlay doit pouvoir se ré-afficher à chaque retour en bas (comportement identique au classique).

Garde-fou comics à 1 page : si pages.length === 1, l'endObserver n'est activé qu'après une interaction utilisateur (scroll ou keydown ArrowDown).

4.6 Synchronisation

// Suivi de l'item actif (Manwa)
const activeObserver = new IntersectionObserver((entries) => {
for (const entry of entries) {
if (entry.isIntersecting) {
state.index = Number(entry.target.dataset.index);
}
}
}, {
root: document.getElementById('manwa-reader'),
rootMargin: '-50% 0px -50% 0px',
threshold: 0,
});

state.index est partagé entre les deux modules via un objet readerState importé/exporté (ou exposé sur window.readerState si pas de modules).

Au toggle Classic → Manwa : scrollIntoView sur l'ID correspondant.

Au toggle Manwa → Classic : reader.js lit readerState.index et affiche la page.

4.7 Script inline anti-flash

Dans head de reader.html :

<script> (function () { var m = document.cookie.match(/(?:^|;\s*)reader_mode=([^;]+)/); if (m && m[1] === 'manwa') { document.documentElement.classList.add('manwa-mode'); } })(); </script>
Le CSS applique ensuite :
html.manwa-mode #classic-reader { display: none; }
html:not(.manwa-mode) #manwa-reader { display: none; }

4.8 Virtualisation

.manwa-item {
content-visibility: auto;
contain-intrinsic-size: 800px 1200px;
}

content-visibility: auto : le navigateur ignore le rendu des li hors viewport.

contain-intrinsic-size : taille estimée pour éviter les sauts de scroll.

Les li restent dans le DOM (pas de virtualiseur JS en v1).

CONTRATS D'INTERFACE

5.1 IDs

ID Type Description
classic-reader conteneur Lecteur classique
manwa-reader conteneur Conteneur scrollable Manwa
manwa-list ul Liste des pages Manwa
manwa-end-sentinel div Sentinelle de fin
reader-toggle button Bouton de bascule
page-XXXXXX li Page Manwa (6 chiffres)

5.2 Cookie

Nom Valeurs Durée Scope Attributs
reader_mode classic | manwa 1 an / SameSite=Lax, Secure (prod)

5.3 État partagé

// readerState.js (ou exposé sur window)
export const readerState = {
index: 0,
pages: [],
mode: 'classic', // 'classic' | 'manwa'
currentVideoTime: null,
};

5.4 Événements personnalisés

Événement Émetteur Payload Écouteur
reader:mode-change toggle { mode } reader.js, manwa.js
reader:end-reached scrollspy — overlay de fin

PLAN DE TESTS

6.1 Tests E2E (tests/e2e/manwa.spec.js)

Fixtures :

comics-many : 20 pages images.

comics-single : 1 page image.

comics-video-only : uniquement des vidéos.

Scénarios :

Scénario Attendu
1 Toggle Classic → Manwa Le conteneur Manwa est visible, aria-pressed="true"
2 Toggle Manwa → Classic Le lecteur classique est visible, position conservée
3 Cookie reader_mode=manwa au chargement Mode Manwa actif sans flash
4 Scroll vertical Les images s'affichent au fur et à mesure
5 Performance lazy loading Seules ~2 images ont un src au chargement initial
6 Scrollspy de fin (comics many) Overlay affiché en bas
7 Scrollspy de fin (comics single) Overlay non affiché au chargement ; affiché après scroll/flèche
8 Comics video-only Toggle masqué, mode classic forcé
9 Synchronisation Classic → Manwa L'item actif correspond à state.index
10 Synchronisation Manwa → Classic Le lecteur classique s'ouvre sur la bonne page
11 Vidéo en Manwa video controls preload="metadata" présent
12 Échec de chargement image Placeholder SVG croix affiché
13 Accessibilité role="list", alt, aria-live, tabindex="0"

6.2 Tests de performance

Vérifier que sur 20 pages, au chargement initial, moins de 5 images ont un src non vide.

Vérifier que le scroll d'une page charge au plus 2 images supplémentaires.

Vérifier le temps de bascule Classic ↔ Manwa (< 100 ms sur desktop).

6.3 Tests d'accessibilité

Audit axe-core (ou manuel) : 0 violation WCAG AA.

Navigation clavier complète : toggle, scroll, ouverture/fermeture de l'overlay.

Lecteur d'écran : annonce « Fin du comics » à l'ouverture de l'overlay.

6.4 Non-régression

Tous les tests existants du lecteur classique passent.

L'ajout des IDs page-XXXXXX ne casse aucun sélecteur existant (vérifier tests/e2e/reader.spec.js).

POINTS D'OMBRE RÉSIDUELS

Point Impact Mitigation
1 content-visibility: auto non supporté sur navigateurs anciens Layout cassé Fallback : ignorer la règle (les images se chargent au scroll normal)
2 Virtualisation native insuffisante sur 500+ pages Perf dégradée Phase 2 : virtualiseur JS si profilage le justifie
3 scrollIntoView sur li non encore rendu (content-visibility) Position imprécise Forcer content-visibility: visible sur l'item cible avant scroll, puis restaurer
4 Cookie partagé entre onglets Un onglet écrase le choix Accepté (J5)
5 Synchronisation vidéo entre lecteurs Timestamp perdu si URL change Sauvegarder currentTime dans readerState.currentVideoTime au toggle
6 Marge de lazy loading fixe (100%) Sous-optimal sur très grand écran Constante ajustable MANWA_ROOT_MARGIN
7 Overlay de fin existant Peut ne pas être conçu pour le flux vertical Vérifier z-index et position: fixed ; ajuster si besoin
8 Comics à 1 page Overlay immédiat Garde-fou : activation après interaction (C4)

RÉCAPITULATIF DES DÉCISIONS

Question Décision
A1 ID page- + 6 chiffres sur le li
A2 Ajout du système d'IDs au lecteur classique
A3 Conteneur scrollable dédié (main id="manwa-reader")
B1 rootMargin: '100% 0px 100% 0px'
B2 IntersectionObserver + unobserve après chargement
B3 Placeholder existant de la page série
B4 Placeholder SVG avec croix
C1 Sentinelle après /ul
C2/C3 Ré-affichage à chaque retour en bas
C4 Activation après interaction pour 1 page
E1/E2 Recommandations appliquées
E3/E4 Mise à jour continue, sync currentTime
E5 Cache HTTP partagé (mêmes URLs)
F2 preload="metadata"
F3 Lazy loading appliqué aux vidéos
G1 role="list"
G2 alt identique au classique
G3 aria-live="polite" « Fin du comics »
G4 aria-pressed suffit
G5 tabindex="0" + scroll natif
G6 Couleurs CSS existantes
H1 Tests dédiés manwa.spec.js
H2 2 comics (many + single) + video-only
H3 Test perf lazy loading
H4 Audit accessibilité
I1 manwa.js séparé
I2 manwa.css séparé, classes préfixées manwa-
I3 Toggle dans le HTML, dark mode
I4 Script inline anti-flash
I5 Cas impossible
J1 Retour menu série (cas impossible)
J2 Toggle masqué si que des vidéos
J3 content-visibility: auto (virtualisation native)
J4 Cookie suffit
J5 Accepté

FIN DU CAHIER DES CHARGES