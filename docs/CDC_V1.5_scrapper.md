Cahier des Charges : Module d'Exécution de Script Python
1. Contexte et Objectifs
Ce module s'intègre à une plateforme Node.js existante. Il a pour but d'offrir une interface utilisateur (UI) permettant de lancer un script Python externe en temps réel, de visualiser sa sortie console (logs) et de suivre son avancement via une barre de progression segmentée en trois phases distinctes.

2. Contrôle d'Accès (Sécurité)
Accès restreint : La page (et l'API sous-jacente) n'est accessible qu'aux utilisateurs authentifiés sur la plateforme.

Note : Les implications techniques liées à l'authentification (gestion des sessions, tokens JWT, etc.) ne sont pas traitées ici, car elles sont supposées déjà gérées par le reste de la plateforme Node.js. L'accès non autorisé doit simplement rediriger vers la page de connexion ou renvoyer une erreur HTTP 401.

3. Configuration (Fichier ./config/config.json)
Le système ne doit pas coder en dur le chemin du script Python. Il doit le lire dynamiquement depuis le fichier de configuration global de la plateforme.

Structure attendue :

json
{
  "python_module": {
    "script_path": "./scripts/process_task.py",
    "python_executable": "python3"
  }
}
Le serveur Node.js devra lire ce fichier au démarrage ou à chaque appel (selon l'architecture existante) pour savoir quel fichier exécuter et avec quel interpréteur.

4. Spécifications Fonctionnelles (Interface Utilisateur)
4.1. Zone de saisie (Input)
Un champ de texte unique avec le placeholder INPUT.

Un bouton à sa droite avec l'icône ->.

Comportement : L'utilisateur saisit une URL (ou un texte). L'appui sur la touche Entrée ou le clic sur le bouton -> déclenche l'exécution du script.

4.2. Console d'affichage
Une zone noire (style terminal) située sous l'input.

Affiche un texte d'attente "console python" centré au repos.

Au lancement du script, ce texte disparaît. La console affiche en temps réel (streaming) les print() générés par le script Python, ligne par ligne. Un auto-scroll doit maintenir le défilement vers le bas.

4.3. Barre de progression multi-phases
Située au-dessus de l'input, elle représente l'état d'avancement du script.

Structure : Divisée visuellement en 3 segments correspondant aux phases :

Phase 1 : Scrapping
Phase 2 : Traduction
Phase 3 : Copie
Fonctionnement :

La barre est initialement vide.

Chaque phase possède un remplissage qui progresse de 0% à 100% pour sa propre section.

Gestion des échecs : Si une phase échoue, la portion de barre correspondant à cette phase devient rouge. Les phases précédentes restent vertes, les suivantes restent noires.

5. Spécifications Techniques (Backend & Communication)
5.1. Architecture de Communication
Pour le temps réel (streaming de la console et de la progression), l'utilisation de Server-Sent Events (SSE) est recommandée car la communication est unidirectionnelle (Serveur -> Client).

5.2. Le pont Node.js -> Python
Le serveur Node.js utilisera le module natif child_process.spawn() (sans shell pour des raisons de sécurité) pour lancer le script défini dans config.json.

L'URL saisie par l'utilisateur sera passée en argument : spawn(python_path, [script_path, user_input_url]).

5.3. Protocole de communication (Mots-clés)
Le script Python est responsable de l'envoi des données via sys.stdout. Pour que Node.js et le Front-end comprennent ce qu'il se passe, le script Python doit utiliser un protocole de balises strict dans ses print() :

Logs classiques : print("Connexion au site...")
-> Affiché tel quel dans la console.

Progression : print("[PHASE:1, PROGRESS:50]")
-> Node.js intercepte cela, met à jour la phase 1 à 50%. Le texte n'est pas affiché dans la console.

Échec d'une phase : print("[PHASE:2, ERROR]")
-> Node.js intercepte, marque la phase 2 en rouge sur l'interface, et affiche une erreur dans la console.

Fin du script : Le processus Python se termine naturellement. Node.js ferme le flux SSE.

5.4. Traitement côté Node.js (API)
Reçoit la requête GET /api/run?url=....

Vérifie l'authentification de l'utilisateur.

Lit ./config/config.json.

Ouvre le flux SSE vers le front (Content-Type: text/event-stream).

Lance le processus Python.

Écoute stdout : Lit les données, détecte les balises [PHASE:X, PROGRESS:Y] ou [PHASE:X, ERROR] et formate les données en JSON avant de les envoyer au client via SSE.

Écoute stderr : Envoie les erreurs Python au client pour affichage en rouge dans la console.

Écoute close : Ferme le flux SSE.

5.5. Traitement côté Front-end (JavaScript)
Au submit du formulaire, ouvre une connexion EventSource vers l'API.

Reçoit les événements JSON.

Si c'est un log : l'ajoute à la console.

Si c'est une progression : ajuste la largeur de la div correspondante dans la barre de chargement (avec une transition CSS fluide).

Si c'est une erreur de phase : ajoute la classe CSS error (rouge) à la div de la phase concernée.

6. Contraintes d'Intégration et d'UI/UX
Design : Respecter la maquette fournie (Noir / Blanc / Vert fluo #00FF00 / Rouge pour les erreurs).

Isolation : L'interface doit être encapsulée (par exemple dans un composant ou un module dédié) pour ne pas interférer avec le CSS global de la plateforme existante.

Ressources : Prévoir un mécanisme pour "tuer" le processus Python si l'utilisateur quitte la page ou ferme l'onglet (événement req.on('close') côté Node) afin d'éviter les processus zombies.

