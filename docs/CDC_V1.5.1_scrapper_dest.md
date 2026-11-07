# CDC V1.6 — Module Scrapper : dossier de destination

Statut : verrouillé
Date   : 2026-11-06
Base   : V1.5 (docs/CDC_V1.5_scrapper.md)

## 1. Objectif

Permettre à l'utilisateur admin de choisir, avant lancement du script Python,
la série et le type de dossier de destination. Le serveur construit un
chemin absolu et le passe en argument au script.

Avant : `{python_executable} {script_path} {lien}`
Après : `{python_executable} {script_path} {lien} {Dossier_dest}`

avec `Dossier_dest = path.resolve(ROOT_DIR, series_dest, folder_dest)`.

## 2. Périmètre

### 2.1 UI (`protected/scrapper.html`)

Deux `<select>` obligatoires ajoutés au formulaire de run :

- `#scrapper-series-dest` : options issues de `GET /api/scrapper/config`
  (`series`). `required`, pas d'option vide présélectionnée.
- `#scrapper-folder-dest` : options statiques `comics`, `comics_admin`,
  `img`, `img_admin`. `required`.

Éléments associés :
- Aperçu **lecture seule** `#scrapper-dest-preview` affichant
  `{ROOT_DIR}/{series_dest}/{folder_dest}/` mis à jour à chaque `change`.
- Bouton « Lancer » `disabled` tant que les 3 champs ne sont pas remplis.
- Libellés accessibles (`<label class="sr-only" for>`).

### 2.2 Endpoint `GET /api/scrapper/config` (étendu)

Réponse (utilisateur autorisé) :
```json
{
  "enabled": true,
  "allowed": true,
  "maxConcurrent": 1,
  "roles": ["admin"],
  "series": ["naruto", "onepiece", "admin_series"],
  "folders": ["comics", "comics_admin", "img", "img_admin"],
  "rootDir": "/chemin/absolu/vers/racine"
}
Réponse (utilisateur non autorisé) :

json
{ "enabled": true, "allowed": false, "reason": "forbidden_role", "roles": ["admin"] }
Aucune fuite de series/folders/rootDir à un utilisateur non autorisé.

2.3 Endpoint GET /api/run (étendu)
Query params obligatoires : url, series_dest, folder_dest.
folder_dest ∈ ["comics","comics_admin","img","img_admin"].

Validation serveur, dans cet ordre, avant tout spawn :

requireAuth() (401).

Module activé (pyCfg non nul, sinon 503).

Rôle ∈ allowed_roles (403).

url : string non vide, ≤ 2048, sans 
\0
 (400).

series_dest : string non vide, sans /, \, \0, ≠ ., .. (400).

folder_dest : ∈ whitelist (400).

store.getSerie(series_dest, role) non null (404 unknown_series).

dest = path.resolve(ROOT_DIR, series_dest, folder_dest).

Contrôle path traversal : dest.startsWith(path.resolve(ROOT_DIR) + path.sep) (403).

Si dest absente :

si python_module.create_dest_if_missing !== false → fs.mkdirSync(dest, {recursive:true}).

sinon → 404 dest_missing.

Rate limit (inchangé V1.5).

Concurrence (inchangée V1.5).

Ensuite : res.set(SSE) puis registry.create({ input, sessionId, cfg, dest, seriesDest, folderDest }).

2.4 Protocole Python
Protocole SSE inchangé ([PHASE:X, PROGRESS:Y], [PHASE:X, ERROR]).
Le script reçoit désormais sys.argv[1]=lien, sys.argv[2]=dossier_dest.

Helpers à ajouter dans scripts/scrapper_protocol.py :

python
def get_destination_folder(argv=None):
    argv = argv if argv is not None else sys.argv
    if len(argv) < 3:
        raise SystemExit("Usage: script.py <lien> <dossier_dest>")
    return Path(argv[2]).resolve()

def ensure_destination(path):
    path.mkdir(parents=True, exist_ok=True)
    return path
Le template scripts/process_task.py est mis à jour pour appeler
get_destination_folder() et écrire dans ce dossier.

2.5 Configuration
config/config.json → section python_module :

json
"python_module": {
  "script_path": "./scripts/process_task.py",
  "python_executable": "python3",
  "allowed_roles": ["admin"],
  "timeout_seconds": 600,
  "create_dest_if_missing": true,
  "rate_limit": { "windowMinutes": 5, "maxAttempts": 10 }
}
Nouveau champ create_dest_if_missing (défaut true).
Validation au démarrage : booléen, sinon module désactivé avec
python_module_disabled_reason = 'invalid_create_dest_if_missing'
(comportement V1.5 conservé : pas de crash).

2.6 Logs (
logs/app.jsonl
)
Événements V1.5 conservés. Champs ajoutés :

scrapper_run_start → { series_dest, folder_dest, dossier_dest }

scrapper_run_end → idem

scrapper_run_error → idem (reste déclenché par le spawn_failed)

scrapper_kill → idem

Nouvel événement (défensif, émis par routes.js) :

scrapper_invalid_dest (warn) → { reason, series_dest, folder_dest, role, ip }
reason ∈ { "missing_series_dest", "invalid_series_dest", "missing_folder_dest", "invalid_folder_dest", "unknown_series", "path_traversal", "dest_missing", "dest_creation_failed" }

2.7 Sécurité
Le client ne fournit jamais de chemin. Il fournit series_dest + folder_dest,
et le serveur recalcule dest à partir de ROOT_DIR.

Contrôle startsWith(ROOT_DIR + sep) après path.resolve.

Aucune écriture disque avant validation complète.

Le scrapper est admin-only (allowed_roles: ["admin"] par défaut, check
existant conservé). Aucune nouvelle exception.

Pas de fuite : /api/scrapper/config ne renvoie series/folders/rootDir
qu'aux utilisateurs autorisés.

2.8 Tests
Unitaires (tests/unit/scrapper.test.js, en plus) :

validation folder_dest (4 valeurs OK, autres 400)

validation series_dest (vide 400, / ou \ ou .. 400, inconnue 404)

path traversal → 403

role hors allowed_roles → 403

create_dest_if_missing=false + dest absente → 404 dest_missing

create_dest_if_missing=true + dest absente → mkdir appelé

argv runner = [script_path, input, dest_absolu]

/api/scrapper/config : sans auth 401 ; reader → allowed:false sans series ;
admin → 4 folders + series

Intégration (tests/integration/scrapper.test.js, en plus) :

400 URL/folder/series manquants ou invalides

404 série inconnue

403 role non autorisé

200 SSE pour admin valide avec argv[2] === destPath vérifié dans le fake

E2E (tests/e2e/scrapper.spec.js, en plus) :

selects peuplés, bouton run disabled tant que non choisis

aperçu du chemin mis à jour au change

run complet → FAKE_SCRAPPER_ARGV_LOG contient le bon dest

Fixture tests/fixtures/fake_scrapper.js :

logue process.argv complet + timestamp dans FAKE_SCRAPPER_ARGV_LOG (JSONL)

émet 3 phases avec progress

code de sortie configurable via FAKE_SCRAPPER_EXIT

2.9 Documentation
README.md : nouvelle entrée V1.6 en tête du changelog.

docs/CDC_V1.6_scrapper_dest.md : ce document.

docs/USAGE.md : section scrapper mise à jour.

docs/SECURITY.md : ajout de la règle « chemin destination recalculé serveur ».

2.10 Rétrocompatibilité
Aucune route publique supprimée.

/api/run devient strict : series_dest et folder_dest obligatoires.

Les scripts Python qui n'acceptent pas le 2e argument doivent être adaptés
(documenté dans scripts/process_task.py).

3. Fichiers impactés
Fichier	Nature	Livré dans
src/config.js	modif (create_dest_if_missing)	batch 1
config/config.example.json	modif	batch 1
src/scrapper/routes.js	modif (config + validation)	batch 1
src/scrapper/registry.js	modif (pass dest)	batch 1
src/scrapper/runner.js	modif (argv + logs)	batch 1
protected/scrapper.html	modif (2 selects)	batch 2
public/js/scrapper.js	modif (options + endpoint)	batch 2
public/css/scrapper.css	modif (styles selects)	batch 2
scripts/scrapper_protocol.py	modif (helpers)	batch 3
scripts/process_task.py	modif (argv)	batch 3
tests/fixtures/fake_scrapper.js	modif (log argv)	batch 3
tests/unit/scrapper.test.js	modif	batch 3
tests/integration/scrapper.test.js	modif	batch 3
tests/e2e/scrapper.spec.js	modif	batch 3
docs/USAGE.md	modif	batch 4
docs/SECURITY.md
modif	batch 4
README.md	modif (changelog)	batch 4
protected/css/scrapper.css : jamais touché (résidu, hors périmètre).

4. Hors périmètre
Copie physique des fichiers par Node (c'est le script Python qui écrit).

Rescan automatique après run.

Upload manuel.

Multi-destinations en un seul run.

5. Hypothèses
store.listSeries(role) renvoie un Array de strings OU d'objets { name }
(sync ou async) — géré via await Promise.resolve(...) dans routes.js.

store.getSerie(name, role) renvoie un objet série OU null
(sync ou async) — même mécanisme.