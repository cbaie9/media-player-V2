# Guide d'utilisation

## Connexion

Ouvrez <http://localhost:3000>. Si vous n'êtes pas connecté, vous êtes
redirigé vers le formulaire de login.

- **reader** — accès lecture complet
- **admin** — identique + peut relancer un scan

Après 5 tentatives échouées sur 15 minutes, l'IP est bloquée temporairement.

## Navigation

```
[Login] → [Liste des séries] → [Comics d'une série] → [Lecteur]
```

### Page « Séries »

Grille de toutes les séries détectées. Chaque carte affiche :

- Nom de la série
- Nombre de comics (`comics/`)
- Nombre d'imagesets (`img/`)

### Page « Série »

Deux onglets :

- **Comics** — contenu de `<serie>/comics/`
- **Images** — contenu de `<serie>/img/`

Cliquez sur une vignette pour ouvrir le lecteur.

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

## Astuces

### Vignettes lentes à charger ?

Elles sont en lazy-loading : elles ne se chargent que quand elles
entrent dans le viewport. Normal sur de grandes séries.

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

Le cache est mis à jour automatiquement.

### Forcer un rescan en tant qu'admin

Depuis une console avec votre cookie de session :

```bash
curl -X POST http://localhost:3000/api/rescan -b "connect.sid=..."
```

Ou en CLI (pas besoin d'être connecté) :

```bash
npm run rescan
```

## Limites connues

- **Pas de sauvegarde de progression** — vous reprenez toujours au début
- **Pas de recherche** ni de tags
- **Pas de support CBZ / CBR / PDF** (V1)
- **Deux comptes fixes** — pas d'inscription

## Raccourcis clavier — résumé

| Touche | Contexte | Action |
|--------|----------|--------|
| `←` | Lecteur | Page précédente |
| `→` | Lecteur | Page suivante |
| `Espace` | Lecteur | Page suivante |
| `Échap` | Lecteur | Retour à la série |
| `Échap` | Overlay fin | Fermer l'overlay |
| `Tab` | Partout | Naviguer entre les éléments focusables |
| `Entrée` | Login | Soumettre |