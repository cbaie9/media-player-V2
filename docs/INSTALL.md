# Guide d'installation

Ce guide vous accompagne de zéro jusqu'à un `media-player-v2` fonctionnel.

## Sommaire

1. [Prérequis](#1-prérequis)
2. [Installation Node.js](#2-installation-nodejs)
3. [Récupération du code](#3-récupération-du-code)
4. [Installation des dépendances](#4-installation-des-dépendances)
5. [Préparation de la médiathèque](#5-préparation-de-la-médiathèque)
6. [Configuration](#6-configuration)
7. [Création des comptes](#7-création-des-comptes)
8. [Premier lancement](#8-premier-lancement)
9. [Démarrage automatique](#9-démarrage-automatique)
10. [Dépannage](#10-dépannage)

---

## 1. Prérequis

- Un ordinateur (Windows, macOS, Linux) qui restera allumé pour servir les
  comics sur votre réseau
- **Node.js 20+**
- Un éditeur de texte (VS Code, Notepad++, etc.)
- **Un dossier contenant vos comics** organisé selon la structure attendue

---

## 2. Installation Node.js

### Windows

Téléchargez l'installeur LTS sur <https://nodejs.org> et exécutez-le.
Vérifiez :

```powershell
node --version   # doit afficher v20.x.x ou plus
npm --version
```

### macOS

```bash
brew install node@20
```

### Linux (Debian / Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 3. Récupération du code

### Avec Git

```bash
git clone https://github.com/<vous>/media-player-v2.git
cd media-player-v2
```

### Sans Git

Téléchargez l'archive ZIP depuis la page GitHub → **Code → Download ZIP**,
puis décompressez.

---

## 4. Installation des dépendances

```bash
npm install
```

Durée : ~30 s à 2 min selon la connexion.

**En cas d'erreur** sur `bcrypt` (compilation native), voir
[Dépannage](#10-dépannage).

---

## 5. Préparation de la médiathèque

Créez un dossier avec cette structure :

```
/media/comics/
├── onepiece/
│   ├── comics/
│   │   ├── comics_a-0001.png
│   │   ├── comics_a-0002.png
│   │   └── comics_a-0003.png
│   └── img/
│       └── cover_a-0001.png
└── naruto/
    └── comics/
        └── chap01-0001.png
```

### Règles de nommage (⚠️ important)

| Règle | Exemple correct |
|-------|-----------------|
| Séparateur = tiret `-` | `comics_a-0001.png` |
| Page = **4 ou 6 chiffres** | `comics_a-0001.png` ou `a-000001.png` |
| Extensions | `.png .jpg .jpeg .webp .gif .mp4 .webm` |
| Un comics = plusieurs fichiers du même `%nom%` | `a-0001.png`, `a-0002.png` |

Les fichiers non conformes sont **ignorés** et listés dans
`logs/scan-warnings.log`.

---

## 6. Configuration

### 6.1. Générer les fichiers par défaut

```bash
npm run init
```

Cela crée :

- `.env` (contient `SESSION_SECRET`)
- `config/config.json` (config principale)

### 6.2. Éditer `config/config.json`

```json
{
  "ROOT_DIR": "/media/comics",
  "USERS_FILE": "./config/users.json",
  "CACHE_FILE": "./cache/scan.json",
  "WARNINGS_FILE": "./logs/scan-warnings.log",
  "APP_LOG_FILE": "./logs/app.jsonl",
  "SESSION_MAX_AGE_HOURS": 24,
  "PORT": 3000,
  "HTTPS": false,
  "SCAN_ON_START": true,
  "LOGIN_RATE_LIMIT": { "windowMinutes": 15, "maxAttempts": 5 }
}
```

### 6.3. Points à adapter

| Champ | Valeur par défaut | À changer si… |
|-------|-------------------|---------------|
| `ROOT_DIR` | `/media` | Vous voulez pointer vers votre médiathèque |
| `PORT` | `3000` | Le port est déjà utilisé |
| `HTTPS` | `false` | Vous avez un reverse proxy TLS |
| `SESSION_MAX_AGE_HOURS` | `24` | Vous voulez une session plus longue/courte |

> 💡 Sur **Windows**, utilisez des chemins absolus avec slashes :
> `"ROOT_DIR": "C:/Users/cleme/Media/comics"`

---

## 7. Création des comptes

Le projet n'a **pas d'inscription**. Les comptes sont prédéfinis dans
`config/users.json`.

### 7.1. Générer les hashs

```bash
npm run hash-password
```

Saisissez un mot de passe (masqué), copiez le hash affiché.

Répétez pour `reader` **et** `admin`.

### 7.2. Créer `config/users.json`

Copiez `config/users.example.json` vers `config/users.json` puis collez
les hashs :

```json
{
  "reader": { "password_hash": "$2b$12$..." },
  "admin":  { "password_hash": "$2b$12$..." }
}
```

### 7.3. (Optionnel) Changer un mot de passe

Régénérez simplement le hash avec `npm run hash-password` et remplacez-le
dans `config/users.json`. Puis redémarrez le serveur.

---

## 8. Premier lancement

### 8.1. Vérifier l'installation

```bash
npm run doctor
```

Cette commande vérifie :

- Version de Node ≥ 20
- Présence de `.env`, `config/config.json`, `config/users.json`
- Accessibilité de `ROOT_DIR`
- Présence des hashs bcrypt

### 8.2. Lancer le serveur

```bash
npm start
```

Sortie attendue :

```
✅ media-player-v2 démarré sur http://localhost:3000
   ROOT_DIR : /media/comics
   Séries   : 2
```

### 8.3. Se connecter

Ouvrez <http://localhost:3000> dans un navigateur et connectez-vous avec
`reader` ou `admin`.

### 8.4. Depuis un autre appareil (mobile, tablette)

Trouvez l'IP locale de la machine serveur :

```bash
# Windows
ipconfig

# macOS / Linux
ifconfig | grep inet
```

Ouvrez ensuite `http://<IP>:3000` depuis votre appareil (même Wi-Fi).

---

## 9. Démarrage automatique

### Windows (via le Planificateur de tâches)

1. Ouvrez le **Planificateur de tâches** → **Créer une tâche**
2. Déclencheur : **Au démarrage de l'ordinateur**
3. Action → **Démarrer un programme** :
   - Programme : `node`
   - Arguments : `src/server.js`
   - Démarrer dans : `C:\chemin\vers\media-player-v2`

### macOS (launchd)

Créez `~/Library/LaunchAgents/com.user.media-player-v2.plist` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.media-player-v2</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/vous/media-player-v2/src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/vous/media-player-v2</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Puis : `launchctl load ~/Library/LaunchAgents/com.user.media-player-v2.plist`

### Linux (systemd)

Créez `/etc/systemd/system/media-player-v2.service` :

```ini
[Unit]
Description=media-player-v2
After=network.target

[Service]
Type=simple
User=votre_user
WorkingDirectory=/home/votre_user/media-player-v2
ExecStart=/usr/bin/node src/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Puis :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now media-player-v2
```

---

## 10. Dépannage

### `npm install` échoue sur `bcrypt`

Cause : compilation native impossible (pas de Python / build-tools).

Solutions :

```bash
# Windows
npm install --global windows-build-tools
npm install

# macOS
xcode-select --install

# Linux
sudo apt install build-essential python3
```

### `ROOT_DIR inaccessible` après login

Vérifiez :

```bash
# Chemin absolu, existe, lisible
ls -la /chemin/vers/mediatheque
```

Sous Windows, évitez les antislashs dans `config.json`.

### Fichiers invisibles

Consultez `logs/scan-warnings.log` :

```bash
cat logs/scan-warnings.log
```

Chaque ligne indique un fichier ignoré avec la raison
(`nom_non_conforme`, `extension_non_supporte`, `numero_invalide`).

### Le port 3000 est déjà pris

Changez dans `config/config.json` : `"PORT": 8080`.

### Mot de passe oublié

Régénérez :

```bash
npm run hash-password
# remplacez dans config/users.json
```

### Besoin d'aide supplémentaire

Ouvrez une issue en joignant :

- Sortie de `npm run doctor`
- 20 dernières lignes de `logs/app.jsonl`
- Version de Node (`node --version`)
- OS et version