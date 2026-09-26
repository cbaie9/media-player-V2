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

## Signaler une vulnérabilité

Ouvrez une [issue privée](https://github.com/<vous>/media-player-v2/security/advisories)
sur GitHub (onglet **Security** → **Report a vulnerability**).

Merci de **ne pas** divulguer publiquement les vulnérabilités avant qu'elles
soient corrigées.