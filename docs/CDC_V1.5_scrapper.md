Cahier des Charges : Module d'Exécution de Script Python
Version : 1.5.0
Statut  : Spécification consolidée — implémentée
Public  : Développeur / mainteneur
================================================================================

0. DÉCISIONS VERROUILLÉES (V1.5.0)
--------------------------------------------------------------------------------

Ce bloc fixe les choix d'implémentation qui ne sont pas explicitement tranchés
dans les sections suivantes. Toute modification ultérieure doit être
documentée ici et dans le changelog du README.

+----+----------------------------------+-----------------------------------------------+
| #  | Sujet                            | Décision                                      |
+----+----------------------------------+-----------------------------------------------+
| D1 | Emplacement de la page           | GET /scrapper → protected/scrapper.html       |
|    |                                  | (hors public/ → pas de bypass static)         |
| D2 | Isolation CSS                    | public/css/scrapper.css, préfixe .scrapper-   |
| D3 | Contrôle d'accès                 | Auth obligatoire + allowed_roles (défaut      |
|    |                                  | ['admin'])                                    |
| D4 | Transport temps réel             | SSE wire format MAIS consommé via fetch() +   |
|    |                                  | ReadableStream (pas EventSource)              |
| D5 | Endpoint de lancement            | GET /api/run?url=... (la connexion = le run)  |
| D6 | Concurrence                      | 1 run / session (config) + 3 runs globaux     |
|    |                                  | (config)                                      |
| D7 | Timeout                          | python_module.timeout_seconds (défaut 600 s)  |
|    |                                  | → SIGTERM puis SIGKILL à +3 s                 |
| D8 | Kill process tree                | POSIX : detached + process.kill(-pid)         |
|    |                                  | Windows : taskkill /T /F                      |
| D9 | Kill triggers                    | Timeout, déconnexion client, arrêt serveur    |
|    |                                  | → kill immédiat (pas de grâce)                |
| D10| Parsing stdout                   | readline (crlfDelay: Infinity), lignes vides  |
|    |                                  | ignorées, ligne max 16 Ko (tronquée + …)      |
| D11| Regex marqueurs                  | /^\s*\[PHASE:\s*(\d+)\s*,\s*PROGRESS:\s*(\d+) |
|    |                                  | \s*\]\s*$/ idem ERROR. Phase ∈ [1..3],        |
|    |                                  | progress ∈ [0..100] sinon bad_marker + skip   |
| D12| Python buffering                 | PYTHONUNBUFFERED=1 + PYTHONIOENCODING=utf-8   |
|    |                                  | + flag -u (uniquement si exécutable Python)   |
| D13| Shell                            | shell: false, spawn direct, env minimal       |
| D14| Injection                        | input passé en argv[1] uniquement             |
| D15| Input                            | trim(), ≤ 2048, rejet des \0                  |
| D16| Backpressure                     | res.write() false → child.stdout.pause() puis  |
|    |                                  | resume() sur 'drain'                          |
| D17| Heartbeat SSE                    | : ping\n\n toutes les 15 s                    |
| D18| Exit ≠ 0 sans marqueur           | Dernière phase ayant reçu un PROGRESS → error |
|    |                                  | (ou phase 1 par défaut)                       |
| D19| Logs applicatifs                 | 5 events app.jsonl : scrapper_run_start,      |
|    |                                  | scrapper_run_end, scrapper_run_error,         |
|    |                                  | scrapper_kill, scrapper_config_invalid        |
| D20| Buffer d'événements              | Aucun (fetch = un seul consommateur)          |
| D21| event: end                       | { exitCode, durationMs, reason } toujours     |
|    |                                  | dernier événement. reason ∈ {ok, error,       |
|    |                                  | timeout, killed, disconnected}                |
| D22| Front auto-scroll                | Scroll bas si ≤ 40 px du bas (préserve lecture |
|    |                                  | si l'utilisateur remonte)                     |
| D23| Front placeholder                | Masqué dès le 1er événement SSE               |
| D24| Front input                      | disabled pendant le run, réactivé sur 'end'   |
| D25| Rate limit                       | 10 req / 5 min / IP sur /api/run (config)     |
| D26| Tests                            | Binaire « python » = Node (process.execPath)  |
|    |                                  | → aucun Python requis en CI                   |
+----+----------------------------------+-----------------------------------------------+

1. Contexte et Objectifs
--------------------------------------------------------------------------------

Ce module s'intègre à une plateforme Node.js existante (media-player-v2). Il
offre une interface utilisateur (UI) permettant de lancer un script Python
externe en temps réel, de visualiser sa sortie console (logs) et de suivre
son avancement via une barre de progression segmentée en trois phases
distinctes.

Architecture retenue :

  Client (navigateur)
    │
    │  fetch('/api/run?url=…')  + ReadableStream  (SSE-like, non EventSource)
    ▼
  Express (src/scrapper/routes.js)
    │
    │  child_process.spawn()  (shell: false, detached POSIX)
    ▼
  Script Python (défini dans config/config.json → python_module.script_path)
    │
    │  sys.stdout.write + flush
    ▼
  Node.js (src/scrapper/runner.js)  →  parse marqueurs  →  SSE events
    │
    ▼
  Client (public/js/scrapper.js)  →  update DOM (barre + console)

Objectifs :
  - Lancer un script externe sans coder en dur son chemin
  - Streamer stdout + stderr + progression en temps réel
  - Tuer le process en cas de déconnexion (pas de zombie)
  - Isoler l'UI (CSS préfixé .scrapper-) pour ne pas interférer avec
    l'existant
  - Ne pas dégrader la sécurité de la plateforme (auth obligatoire, pas
    d'injection shell, protection contre les runs concurrents)

2. Contrôle d'Accès (Sécurité)
--------------------------------------------------------------------------------

Accès restreint : la page (/scrapper) et les API sous-jacentes
(/api/run, /api/scrapper/config) exigent une session authentifiée.

Rôles autorisés configurables via config.python_module.allowed_roles.
DÉFAUT : ["admin"] — le module exécute du code arbitraire (SSRF, CPU,
réseau), donc restreint par défaut.

Un utilisateur authentifié mais de rôle non autorisé reçoit :
  - /scrapper         → 200 (page) mais le bouton submit est masqué/désactivé
    si /api/scrapper/config ne confirme pas l'autorisation
  - /api/run          → 403 { "error": "forbidden" }
  - /api/scrapper/config → 200 { enabled: true, roles: [...] } (info)

Un utilisateur non authentifié reçoit :
  - /scrapper         → 302 vers /login
  - /api/run          → 401 { "error": "unauthorized" }
  - /api/scrapper/config → 401 { "error": "unauthorized" }

L'authentification (session cookie, bcrypt) est gérée par la plateforme
existante (src/auth.js) — non traitée par ce module.

3. Configuration (Fichier ./config/config.json)
--------------------------------------------------------------------------------

Le système ne doit pas coder en dur le chemin du script Python. Il le lit
dynamiquement depuis le fichier de configuration global de la plateforme.

Structure attendue :

  {
    "python_module": {
      "script_path": "./scripts/process_task.py",
      "python_executable": "python3",
      "cwd": "./scripts",
      "timeout_seconds": 600,
      "max_concurrent_per_session": 1,
      "max_concurrent_global": 3,
      "allowed_roles": ["admin"],
      "rate_limit": { "windowMinutes": 5, "maxAttempts": 10 }
    }
  }

Champs :

  script_path           (requis)   Chemin du script. Résolu via
                                   path.resolve(PROJECT_ROOT, …). Le fichier
                                   doit exister au démarrage, sinon module
                                   désactivé.
  python_executable     (défaut "python3")  Interpréteur. Sondé via
                                   `spawnSync(exe, ['--version'])` au boot.
                                   Si ENOENT → module désactivé.
  cwd                   (défaut dirname(script_path))
  timeout_seconds       (défaut 600, min 10)  Timeout global du run.
  max_concurrent_per_session  (défaut 1)  Runs simultanés par session.
  max_concurrent_global       (défaut 3)  Runs simultanés tous utilisateurs.
  allowed_roles         (défaut ["admin"])  Sous-ensemble de
                                            ["reader", "admin"].
  rate_limit            (défaut 5 min / 10 req)  Appliqué sur /api/run.

Validation au démarrage (src/config.js → validatePythonModule) :

  - si python_module absent      → config.python_module = null,
                                    config.python_module_disabled_reason =
                                    'absent', PAS de warning console
                                    (plateforme < V1.5 = comportement
                                    inchangé)
  - si python_module invalide    → config.python_module = null,
                                    disabled_reason précis,
                                    WARNING console explicite
  - si valide                    → config.python_module = objet normalisé
                                    (chemins absolus, valeurs numériques
                                    validées)

Le serveur démarre TOUJOURS, même si python_module est invalide. Toute
la partie Scrapper répond alors 503 { "error": "scrapper_disabled" }.

4. Spécifications Fonctionnelles (Interface Utilisateur)
--------------------------------------------------------------------------------

4.1. Zone de saisie (Input)
--------------------------------------------------------------------------------

Un champ de texte unique avec le placeholder INPUT.

Un bouton à sa droite avec l'icône ->.

Comportement : l'utilisateur saisit une URL (ou un texte). L'appui sur la
touche Entrée ou le clic sur le bouton -> déclenche l'exécution du script.

Contraintes d'implémentation :
  - input.maxLength = 2048
  - input.spellcheck = false
  - input.autofocus
  - input désactivé (disabled) pendant le run, réactivé sur event 'end'
  - Touche Entrée gérée via <form> + submit (pas de keydown custom)

4.2. Console d'affichage
--------------------------------------------------------------------------------

Une zone noire (style terminal) située sous l'input.

Affiche un texte d'attente "console python" centré au repos.

Au lancement du script, ce texte disparaît. La console affiche en temps réel
(streaming) les print() générés par le script Python, ligne par ligne. Un
auto-scroll doit maintenir le défilement vers le bas.

Contraintes d'implémentation :
  - placeholder masqué dès le 1er événement SSE (meta / log / stderr /
    phase / error)
  - auto-scroll UNIQUEMENT si l'utilisateur est à ≤ 40 px du bas
  - stderr coloré en rouge (#FF2A2A)
  - logs classiques en couleur par défaut (héritée du CSS)
  - les marqueurs [PHASE:X, PROGRESS:Y] et [PHASE:X, ERROR] ne sont PAS
    affichés comme logs — ils sont transformés en événements SSE

4.3. Barre de progression multi-phases
--------------------------------------------------------------------------------

Située au-dessus de l'input, elle représente l'état d'avancement du script.

Structure : divisée visuellement en 3 segments correspondant aux phases :

  Phase 1 : Scrapping
  Phase 2 : Traduction
  Phase 3 : Copie

Fonctionnement :
  - La barre est initialement vide (width 0% par segment)
  - Chaque phase possède un remplissage qui progresse de 0% à 100% pour
    sa propre section
  - Chaque segment porte role="progressbar" + aria-valuemin/max/now
  - Transition CSS fluide (width .3s ease)

Gestion des échecs :
  - Si une phase échoue, la portion de barre correspondant à cette phase
    devient rouge (#FF2A2A)
  - Les phases précédentes restent vertes (#00FF00)
  - Les suivantes restent noires (width 0%)
  - Une fois marquée en erreur, une phase ne peut plus être réécrite par
    un PROGRESS ultérieur (protection côté client)

5. Spécifications Techniques (Backend & Communication)
--------------------------------------------------------------------------------

5.1. Architecture de Communication
--------------------------------------------------------------------------------

Pour le temps réel, l'utilisation de Server-Sent Events (SSE) est
recommandée — communication unidirectionnelle (Serveur → Client).

DÉCISION D4 : le protocole est SSE (wire format : `event: <type>\ndata:
<json>\n\n`), MAIS le client utilise fetch() + ReadableStream et NON
EventSource. Raisons :
  - EventSource ne permet pas de lire le statut HTTP (400/401/409/503)
  - EventSource reconnecte automatiquement → relancerait le script
  - EventSource ne supporte pas l'annulation propre (AbortController)

Headers de la réponse SSE :
  Content-Type: text/event-stream; charset=utf-8
  Cache-Control: no-cache, no-transform
  Connection: keep-alive
  X-Accel-Buffering: no      (désactive le buffering nginx)

Un heartbeat `: ping\n\n` est émis toutes les 15 s pour traverser les
reverse-proxies.

5.2. Le pont Node.js → Python
--------------------------------------------------------------------------------

Le serveur Node.js utilise child_process.spawn() (shell: false) pour lancer
le script défini dans config.json.

L'URL saisie par l'utilisateur est passée en argument :
  spawn(python_path, [script_path, user_input_url])

DÉCISION D12 : le flag -u n'est ajouté QUE si l'exécutable ressemble à
Python (basename = "py" ou commence par "python"). Pour tout autre binaire
(node, sh, …), pas de -u. Cette heuristique évite un crash immédiat
(`node -u script.js` → exit 9) et reste valide pour le vrai Python.
PYTHONUNBUFFERED=1 est de toute façon passé dans l'env, donc même sans -u
le débufferisation fonctionne.

Env minimal exposé :
  PATH, HOME, LANG, LC_ALL, PYTHONUNBUFFERED, PYTHONIOENCODING
  + sur Windows : SYSTEMROOT, PATHEXT, APPDATA, LOCALAPPDATA, USERPROFILE,
                  TEMP, TMP

DÉCISION D8 : sur POSIX, spawn(detached: true) → le process est chef de
groupe, `process.kill(-pid, SIGTERM)` tue tout l'arbre (y compris les
sous-processus Python éventuels). Sur Windows, `taskkill /pid X /T /F`.

5.3. Protocole de communication (Mots-clés)
--------------------------------------------------------------------------------

Le script Python est responsable de l'envoi des données via sys.stdout.
Pour que Node.js et le Front-end comprennent ce qu'il se passe, le script
Python doit utiliser un protocole de balises strict dans ses print() :

  Logs classiques : print("Connexion au site...")
    → Affiché tel quel dans la console.

  Progression : print("[PHASE:1, PROGRESS:50]")
    → Node.js intercepte, met à jour la phase 1 à 50%.
      Le texte n'est PAS affiché dans la console.

  Échec d'une phase : print("[PHASE:2, ERROR]")
    → Node.js intercepte, marque la phase 2 en rouge sur l'interface,
      et affiche une erreur dans la console (ligne stderr).

  Fin du script : le processus Python se termine naturellement.
    → Node.js émet un event 'end' et ferme le flux SSE.

Contraintes d'implémentation :
  - Chaque marqueur doit tenir sur UNE SEULE ligne
  - Chaque marqueur doit être flush() (sinon le streaming SSE est retardé)
  - Phases valides : 1, 2, 3 (hors plage → bad_marker, ligne ignorée)
  - Progress valides : 0..100 (hors plage → bad_marker, ligne ignorée)
  - Regex tolérante : espaces optionnels en début/fin de ligne, autour des
    tokens. `[PHASE:1,PROGRESS:50]` et `[PHASE:1 , PROGRESS:50]` OK.
  - Toute autre sortie stdout = log classique
  - stderr = affiché en rouge dans la console
  - exit code 0 = succès ; ≠ 0 = échec (la dernière phase ayant reçu un
    PROGRESS devient rouge si aucun marqueur d'erreur explicite — D18)
  - NE PAS utiliser argparse côté Python : l'input est en argv[1] et peut
    commencer par "-" (argparse le confondrait avec une option)

Helpers recommandés côté Python (scripts/scrapper_protocol.py) :
  log_msg(text)              → print(text, flush=True)
  phase_progress(phase, pct) → print(f"[PHASE:{phase}, PROGRESS:{pct}]", flush=True)
  phase_error(phase)         → print(f"[PHASE:{phase}, ERROR]", flush=True)
  get_input()                → sys.argv[1] avec validation

5.4. Traitement côté Node.js (API)
--------------------------------------------------------------------------------

  GET /api/run?url=<input>

  1. Vérifie le module actif (config.python_module) → 503 sinon
  2. Vérifie l'authentification (session) → 401 sinon
  3. Vérifie le rôle autorisé → 403 sinon
  4. Valide l'input (trim, ≤ 2048, rejette \0) → 400 sinon
  5. Vérifie la concurrence (session + global) → 409 / 429 sinon
  6. Applique le rate limit (10 req / 5 min / IP) → 429 sinon
  7. Ouvre le flux SSE (Content-Type: text/event-stream)
  8. Crée un Run (registry.create) et l'attache à res
  9. Enregistre res.on('close') → run.kill('client_disconnected')
  10. Lance le process Python (run.start)
  11. Écoute stdout :
        - marqueurs PROGRESS/ERROR → events SSE phase
        - autre → event SSE log
  12. Écoute stderr → event SSE stderr
  13. Écoute timeout → event SSE error + kill
  14. Écoute close (child) → event SSE end (avec reason) + res.end()

Protocole wire (SSE) :

  | event:   | data: (JSON)                        | Émis quand                 |
  |----------|-------------------------------------|----------------------------|
  | meta     | { runId, input, startedAt }         | juste avant le spawn       |
  | log      | { line }                            | ligne stdout non-marqueur  |
  | stderr   | { line }                            | ligne stderr               |
  | phase    | { phase:1..3, progress:0..100 }     | marqueur PROGRESS valide   |
  | phase    | { phase:1..3, status:"error" }      | marqueur ERROR ou exit≠0   |
  |          |                                     | sans marqueur (D18)        |
  | error    | { message }                         | spawn fail, timeout, autre |
  | end      | { exitCode, durationMs, reason }    | toujours dernier, avant    |
  |          |                                     | res.end()                  |

  reason ∈ { ok, error, timeout, killed, disconnected }

Logs applicatifs (logs/app.jsonl, D19) :
  scrapper_run_start      { runId, sessionId, input (≤200 chars), pid }
  scrapper_run_end        { runId, sessionId, exitCode, durationMs, reason }
  scrapper_run_error      { runId, sessionId, message }
  scrapper_kill           { runId, sessionId, reason }
  scrapper_config_invalid { reason, … }  (au démarrage uniquement)

5.5. Traitement côté Front-end (JavaScript)
--------------------------------------------------------------------------------

Au submit du formulaire, ouvre une connexion fetch() vers l'API.

Reçoit les événements SSE (parseur maison) :
  - meta    → masque le placeholder
  - log     → ajoute une ligne blanche dans la console
  - stderr  → ajoute une ligne rouge dans la console
  - phase (progress) → ajuste la largeur du .scrapper-fill (transition CSS)
  - phase (error)    → ajoute data-status="error" (fond rouge)
  - error   → affiche [ERREUR] … en rouge
  - end     → affiche [fin] code X · Y s · reason, réactive l'input

Auto-scroll intelligent (D22) :
  - à chaque nouvelle ligne, on scroll si l'utilisateur est ≤ 40 px du bas
  - s'il est remonté, on ne l'arrache pas

Annulation (D9) :
  - beforeunload → abortCtrl.abort() → res.on('close') serveur → kill
  - visibilitychange = hidden → abortCtrl.abort() (Safari mobile)

6. Contraintes d'Intégration et d'UI/UX
--------------------------------------------------------------------------------

Design : respecter la maquette fournie (Noir / Blanc / Vert fluo #00FF00
/ Rouge pour les erreurs).

Palette appliquée :
  --scrapper-vert  : #00FF00
  --scrapper-rouge : #FF2A2A
  --scrapper-noir  : #000000
  --scrapper-blanc : #FFFFFF

Isolation : l'interface est encapsulée dans public/css/scrapper.css avec
le préfixe .scrapper- systématique. La page /scrapper utilise sa propre
classe body (.scrapper-body) pour ne pas hériter du thème sombre global.
Aucune règle de style.css n'est modifiée par le module (seul un
`.nav-link` a été ajouté pour le lien de navigation global).

Ressources : mécanisme de « kill » si l'utilisateur quitte la page ou
ferme l'onglet (res.on('close') côté Node) pour éviter les processus
zombies.

Triggers de kill (D9) :
  - res.on('close')      → raison 'client_disconnected' → reason SSE
                            'disconnected'
  - timeout_seconds      → raison 'timeout'
  - SIGINT / SIGTERM     → raison 'shutdown' → reason SSE 'killed'
  - erreur interne       → raison 'killed'

Le kill est immédiat (SIGTERM puis SIGKILL à +3 s). Sur POSIX, le groupe
de processus entier est tué (detached: true).

Tests (D26) :
  - Unitaires : parser marqueurs, normalizeEndReason, isPythonExecutable,
    killTree, registry (factory isolée)
  - Intégration : flux SSE complet, abort, validation (401/403/400/409/
    429/503)
  - E2E : Playwright avec un server-fixture dédié (python_executable =
    process.execPath, script_path = tests/fixtures/fake_scrapper.js)

================================================================================
FIN DU DOCUMENT V1.5.0
================================================================================