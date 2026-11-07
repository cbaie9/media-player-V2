# Sécurité

## ⚠️ Avertissement

**Ce projet n'est PAS destiné à être exposé sur Internet.**

Utilisez-le exclusivement via :

- Un **réseau local** (LAN)
- Un **VPN privé** (WireGuard, Tailscale, OpenVPN, …)

Si vous devez absolument l'exposer, placez un **reverse proxy TLS**
(Caddy, nginx) devant, activez `"HTTPS": true` dans la config, et
ajoutez une couche d'authentification supplémentaire (Basic Auth, SSO).

## Modèle de menace

### Ce qui est protégé

- 🔐 **Mots de passe** : hashés bcrypt (coût ≥ 12), jamais loggés
- 🍪 **Sessions** : cookie `HttpOnly` + `SameSite=Strict` (et `Secure` si HTTPS)
- 🚧 **Path traversal** : protection via `fs.realpathSync` + validation
  `startsWith(rootDir + sep)`
- 🔗 **Symlinks sortants** : refusés (le realpath est vérifié)
- ⏱️ **Timing attacks** : `bcrypt.compare` appelé même si l'utilisateur
  n'existe pas (hash factice)
- 🔒 **Brute force** : 5 tentatives / 15 min / IP

### Ce qui n'est PAS protégé

- ❌ **CSRF** : non implémenté (usage LAN uniquement)
- ❌ **XSS** : atténué par `escapeHtml` côté client, mais pas de CSP
- ❌ **Clickjacking** : pas de `X-Frame-Options`
- ❌ **HTTPS** : pas géré nativement (reverse proxy recommandé)
- ❌ **Rate limit distribué** : en mémoire, réinitialisé au restart
- ❌ **Traçage d'audit** : logs simples, pas de chaînage cryptographique

## Bonnes pratiques

### 1. Mots de passe forts

Utilisez des mots de passe **longs** (≥ 16 caractères) pour `reader` et
`admin`.

```bash
npm run hash-password
```

### 2. Isolez la médiathèque

Le compte système qui exécute `media-player-v2` ne doit avoir accès
qu'au dossier `ROOT_DIR` et au projet lui-même.

### 3. Restez à jour

```bash
npm outdated
npm update
npm audit
```

### 4. Sauvegardez `config/`

Les hashs bcrypt ne sont **pas** récupérables. Sauvegardez
`config/users.json` et `.env`.

### 5. Surveillez les logs

`logs/app.json` contient tous les événements :

```bash
# Compter les échecs de login par IP
cat logs/app.json | grep login_failure | jq -r .ip | sort | uniq -c
```

### 6. Fermez le port aux réseaux publics

Configurez votre pare-feu pour que le port `3000` ne soit accessible que
depuis votre LAN/VPN.
# Compter les lancements de scrapper
```bash
cat logs/app.jsonl | grep scrapper_run_start | jq -r .series_dest | sort | uniq -c
```
6. Fermez le port aux réseaux publics
Configurez votre pare-feu pour que le port 3000 ne soit accessible que
depuis votre LAN/VPN.

### Module Scrapper (V1.5 → V1.5.1)
- Le module exécute un script Python externe sur demande d'un admin.
- Il introduit des risques spécifiques (SSRF, consommation CPU, écriture
disque). Les mesures prises :

#### Contrôle d'accès
Auth obligatoire (session).

allowed_roles (défaut ["admin"]) vérifié avant toute action
sur /api/run et /api/scrapper/config.

Un reader reçoit 403 forbidden sur /api/run, même s'il est
authentifié. /api/scrapper/config reste accessible mais ne renvoie
que { enabled, allowed: false, reason, roles } — aucune fuite
de series, folders ou rootDir.

### Injection shell
```javascript
spawn(python_executable, args, { shell: false }) — pas de shell
```
intermédiaire, donc pas d'injection possible via lien, série ou
folder.

lien : trim, longueur ≤ 2048, \0 refusé.

série : refusée si elle contient /, \, \0, si elle vaut .
ou .., ou si elle n'existe pas dans le scan cache pour le rôle
(→ 404 unknown_series).

folder : whitelist stricte {comics, comics_admin, img, img_admin}
(→ 400 invalid_folder_dest).

### Path traversal (V1.5.1)
Le chemin de destination n'est jamais fourni par le client. Le
serveur :

**Valide série + folder comme ci-dessus.**
```javascript
Calcule dest = path.resolve(ROOT_DIR, série, folder).
```
Vérifie que dest.startsWith(path.resolve(ROOT_DIR) + path.sep).

Si non → 403 path_traversal. Aucune écriture disque n'a lieu
avant cette vérification.

### Création de dossier (V1.5.1)
Contrôlée par python_module.create_dest_if_missing :
```javascript
true (défaut) : fs.mkdirSync(dest, { recursive: true }) avant
```
spawn, uniquement après validation complète (auth, rôle, série,
folder, path traversal).

false : si le dossier n'existe pas → 404 dest_missing, aucune
création.

### Kill process
```javascript
res.on('close') (déconnexion) → kill immédiat.
```
Timeout python_module.timeout_seconds → kill (SIGTERM puis SIGKILL
à +3 s).

SIGINT/SIGTERM serveur → registry.killAll() pour tout tuer.

POSIX : spawn(detached: true) + process.kill(-pid) → tue tout
l'arbre de processus. Windows : taskkill /T /F.
## Signaler une vulnérabilité

Ouvrez une [issue privée](https://github.com/<vous>/media-player-v2/security/advisories)
sur GitHub (onglet **Security** → **Report a vulnerability**).

Merci de **ne pas** divulguer publiquement les vulnérabilités avant qu'elles
soient corrigées.