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

### Formats supportés

| Type | Extensions | Compatibilité navigateur |
|---|---|---|
| Images classiques | `.png` `.jpg` `.jpeg` `.webp` `.gif` | Tous navigateurs modernes |
| Images modernes | `.jxl` | Chrome 155+ · Firefox 158+ · Safari 17+ |
| Images modernes | `.avif` | Chrome 85+ · Firefox 93+ · Safari 16.4+ |
| Vidéos | `.mp4` `.webm` | Support natif HTML5 |

⚠️ **`.jxl` et `.avif`** sont récents. Sur un navigateur plus ancien, l'image
s'affichera cassée (placeholder SVG). Pour un usage LAN/VPN, utilisez un
navigateur à jour (Chrome, Firefox ou Safari récent).

🔄 **Après ajout de fichiers `.jxl`/`.avif`**, un `npm run rescan` (ou un
redémarrage serveur) est nécessaire pour les voir apparaître.
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
### Utilisation (V1.5.1)

Le formulaire comporte 3 champs obligatoires :

1. **Série de destination** — `<select>` alimenté par les séries détectées
   (`GET /api/scrapper/config` → `series`)
2. **Type de dossier** — `<select>` parmi `comics`, `comics_admin`, `img`,
   `img_admin`
3. **Lien du comics à scrapper** — champ texte (≤ 2048 caractères)

Le bouton **Lancer** n'est actif que si les 3 champs sont remplis.

Un **aperçu en lecture seule** affiche le chemin de destination calculé :
{ROOT_DIR}/{série}/{folder}/

text

Exemple : `ROOT_DIR=/media`, série `naruto`, folder `comics` → destination
réelle `/media/naruto/comics/`.

### Que reçoit le script Python ?

Le serveur appelle :
{python_executable} -u {script_path} {lien} {dossier_dest}

text

- `argv[1]` = lien saisi par l'utilisateur
- `argv[2]` = chemin absolu du dossier de destination
  (`{ROOT_DIR}/{série}/{folder}`)

Le script écrit ses fichiers directement dans `argv[2]`. Le dossier est
créé automatiquement par le serveur si nécessaire (voir
`python_module.create_dest_if_missing` ci-dessous).

### Création automatique du dossier destination

Par défaut (`python_module.create_dest_if_missing: true`), le serveur
crée `{ROOT_DIR}/{série}/{folder}/` s'il n'existe pas avant de lancer le
script. Si tu préfères qu'une destination inexistante fasse échouer le
lancement (404 `dest_missing`), mets `false` dans `config/config.json`.

### Sécurité

- Le client **ne fournit jamais** de chemin. Il fournit uniquement
  `série` + `folder`, le serveur recalcule le chemin à partir de
  `ROOT_DIR` et vérifie qu'il reste bien sous `ROOT_DIR` (protection
  contre le path traversal).
- `série` est validée contre le scan cache : une série inconnue renvoie
  `404 unknown_series`.
- `folder` est validé contre une whitelist de 4 valeurs.
- Le module est réservé aux administrateurs (`allowed_roles` dans la
  config).
- Concurrence limitée : 1 run par session + 3 runs globaux.
- Rate limit : 10 requêtes / 5 min / IP.

### Protocole côté script Python

Le script doit utiliser `scripts/scrapper_protocol.py` :

```python
from scrapper_protocol import (
    log_msg, phase_progress, phase_error,
    get_input, get_destination_folder, ensure_destination,
)

url = get_input()                       # argv[1]
dest = get_destination_folder()         # argv[2]
ensure_destination(dest)                # mkdir -p

log_msg(f"Scrapping {url} → {dest}")
phase_progress(1, 50)                   # barre phase 1 → 50 %
phase_error(2)                          # phase 2 devient rouge
Le protocole SSE ([PHASE:X, PROGRESS:Y] / [PHASE:X, ERROR]) est
inchangé depuis V1.5. Les seules nouveautés V1.5.1 sont
get_destination_folder() et ensure_destination().
```
Configuration serveur
Dans config/config.json :

```json
"python_module": {
  "script_path": "./scripts/process_task.py",
  "python_executable": "python3",
  "allowed_roles": ["admin"],
  "timeout_seconds": 600,
  "max_concurrent_per_session": 1,
  "max_concurrent_global": 3,
  "create_dest_if_missing": true,
  "rate_limit": { "windowMinutes": 5, "maxAttempts": 10 }
}
Le module est désactivé proprement si :
```
python
_module
 est absent → réponse 503 sur /api/run

script_path pointe vers un fichier inexistant

python_executable introuvable (ENOENT)

create_dest_if_missing n'est pas un booléen

Le serveur démarre toujours, même dans ces cas.

## Astuces
#### Vignettes lentes à charger ?
Elles sont en lazy-loading : elles ne se chargent que quand elles
entrent dans le viewport. Normal sur de grandes séries.

#### Un comics n'apparaît pas ?
Ouvrez logs/scan-warnings.log

Cherchez le nom du fichier

Corrigez le nom pour respecter %nom%-%0001.png

Relancez npm run rescan (ou redémarrez le serveur)

#### Ajouter une nouvelle série
Créez un dossier sous ROOT_DIR : ROOT_DIR/masérie/

Créez masérie/comics/ et/ou masérie/img/
(et éventuellement _admin pour un accès admin-only)

Placez-y vos fichiers avec le bon format de nom

npm run rescan (ou attendez le prochain redémarrage)

Le cache est mis à jour automatiquement.

#### Forcer un rescan en tant qu'admin
Depuis une console avec votre cookie de session :

```bash
curl -X POST http://localhost:3000/api/rescan -b "connect.sid=..."
```
Ou en CLI (pas besoin d'être connecté) :

```bash
npm run rescan
```
### Limites connues
Pas de sauvegarde de progression — vous reprenez toujours au début

Pas de recherche ni de tags

Pas de support CBZ / CBR / PDF (V1)

Deux comptes fixes — pas d'inscription

Module Scrapper : le script Python doit être adapté pour accepter
argv[2] = dossier de destination (voir scripts/process_task.py)
## Tests et fixtures

### Lancer les tests

Le projet utilise le **runner de tests natif de Node.js** (`node:test`) et
**Playwright** pour les tests E2E. Aucune dépendance de test externe n'est
requise en dehors de celles du `package.json`.

```bash
npm test                 # suite complète (unit + integration + e2e, fail fast)
npm run test:unit        # tests unitaires uniquement
npm run test:integration # tests d'intégration (supertest) uniquement
npm run test:e2e         # tests Playwright uniquement
```
Les tests E2E utilisent tests/e2e/server-fixture.js avec un 
ROOT_DIR

isolé (.tmp-root/) : ils ne touchent jamais à votre configuration
réelle ni à votre médiathèque.
### Politique de fixtures (V1.5.3)
Pour éviter l'accumulation de fichiers résiduels après un run, tous les
tests suivent une règle stricte :

|Type de donnée créée pendant les tests |	Emplacement	Nettoyage
| Comics (images, vidéos, dossiers de série) |	tests/fixtures/<nom>/	| before() + after()
| Logs (.log, .jsonl)	os.tmpdir() | (mpv2-*)	| after() obligatoire
| Caches JSON (.json)	os.tmpdir() | (mpv2-*)	| after() obligatoire
| Config / env (.env, config.json) |	os.tmpdir() (mpv2-*)	| after() obligatoire
**Rationnel** : les comics sont des données **persistantes réutilisables**
qui doivent être inspectables en cas d'échec. Les logs/caches/configs sont
des artefacts jetables propres à un test — ils n'ont aucune valeur
post-exécution.

### Répertoires de fixtures
Les répertoires suivants sont générés à chaque run et supprimés
automatiquement (after() global). Ils sont listés dans .gitignore et
ne doivent jamais être commités.

```text
tests/fixtures/
├── root_tests/       # scanner.test.js (via makeFixtures())
├── scanner/          # scanner.test.js (sous-dossiers par test)
├── media_root/       # media.test.js
├── api_root/         # api.test.js
└── store_root/       # store.test.js
```
Les fixtures partagées (contenu commun à plusieurs tests) vivent dans
tests/fixtures/root_tests/ et sont générées par scripts/make-fixtures.js
via makeFixtures(). Le script wipe le répertoire avant de le recréer, ce
qui garantit un état propre à chaque exécution.

### Ajouter un nouveau test
1. Créer le fichier **au bon endroit** :

'tests/unit/' — logique pure, pas d'I/O HTTP

'tests/integration/' — routes Express via supertest

'tests/e2e/' — parcours navigateur via Playwright

2. Respecter la politique fixtures :

Si votre test crée des comics → 'tests/fixtures/<nom-test>/'
(wipe au before(), cleanup au after()).

Si votre test crée des 'logs/caches/configs' → os.tmpdir() avec
cleanup au after().

3. Isoler les tests : aucun test ne doit dépendre de l'ordre
d'exécution ni du résultat d'un autre test.

- Sur Windows : les tests qui dépendent de la casse réelle du
système de fichiers (Linux/macOS) doivent être marqués
'{ skip: onWindows && 'FS case-insensitive sur Windows' }.'

Vérifier l'absence de résidus
Après un run de tests, aucun répertoire temporaire ne doit subsister :

```bash
# Linux / macOS
ls /tmp | grep -E 'mpv2-|scrapper-it-'   # ne doit rien afficher
```
# Windows (PowerShell)
```powershell
Get-ChildItem $env:TEMP -Filter 'mpv2-*'  # ne doit rien afficher
Get-ChildItem $env:TEMP -Filter 'scrapper-it-*'
Si des résidus apparaissent, c'est qu'un test viole la politique
ci-dessus — signalez-le en issue avec la sortie de la commande.
```


---