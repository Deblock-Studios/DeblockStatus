# Backend — Deblock Status API

Ce dossier contient le **Worker Cloudflare** qui surveille les services Deblock Studios.

Toutes les 5 minutes, il ping les sites listés dans [`services.json`](services.json),
enregistre le résultat dans **Workers KV**, puis expose le tout en JSON à la page de statut.

Aucun serveur à gérer, aucune base de données à installer : Cloudflare héberge et exécute le code.

---

## Sommaire

1. [Ce que fait le Worker](#1-ce-que-fait-le-worker)
2. [Ce qu'il vous faut](#2-ce-quil-vous-faut)
3. [Installation pas à pas](#3-installation-pas-à-pas)
   - [3.1 Installer Node.js et les dépendances](#31-installer-nodejs-et-les-dépendances)
   - [3.2 Se connecter à Cloudflare](#32-se-connecter-à-cloudflare)
   - [3.3 Créer le stockage KV](#33-créer-le-stockage-kv)
   - [3.4 Tester en local](#34-tester-en-local)
   - [3.5 Déployer](#35-déployer)
   - [3.6 Brancher la page de statut](#36-brancher-la-page-de-statut)
4. [Gérer la liste des services](#4-gérer-la-liste-des-services)
5. [Comprendre le fonctionnement](#5-comprendre-le-fonctionnement)
6. [Référence de l'API](#6-référence-de-lapi)
7. [Configuration (`wrangler.jsonc`)](#7-configuration-wranglerjsonc)
8. [Limites et coûts](#8-limites-et-coûts)
9. [Dépannage](#9-dépannage)
10. [Sécurité](#10-sécurité)
11. [Structure des fichiers](#11-structure-des-fichiers)
12. [Aide-mémoire des commandes](#12-aide-mémoire-des-commandes)

---

## 1. Ce que fait le Worker

```
        Cron Cloudflare (toutes les 5 min)
                    │
                    ▼
        ┌───────────────────────┐
        │  Worker DeblockStatus │──── fetch ──▶ sites / APIs surveillés
        └──────────┬────────────┘
                   │ résultats (ok, latence, code HTTP, erreur)
                   ▼
        ┌───────────────────────┐
        │  Workers KV           │  historique des 90 derniers jours
        └──────────┬────────────┘
                   │
                   ▼
        GET /api/status ──▶ page de statut (index.html)
```

Trois notions Cloudflare suffisent pour comprendre :

| Terme | Ce que c'est | À quoi ça sert ici |
| --- | --- | --- |
| **Worker** | Un petit programme JavaScript exécuté par Cloudflare, sans serveur | Pinger les services et répondre à l'API |
| **Cron Trigger** | Un déclencheur horaire (« toutes les 5 minutes ») | Lancer les tests automatiquement |
| **Workers KV** | Un stockage clé → valeur, accessible depuis le Worker | Conserver l'historique et calculer l'uptime |

Sans KV, le Worker fonctionne quand même : il teste les services à la volée à chaque
appel de `/api/status`, mais sans historique ni pourcentages de disponibilité.

---

## 2. Ce qu'il vous faut

- Un **compte Cloudflare** gratuit : <https://dash.cloudflare.com/sign-up>
- **Node.js 22 ou plus récent** : <https://nodejs.org> (version LTS)
- Un terminal (PowerShell, Terminal macOS ou shell Linux)
- Les services à surveiller, avec une URL `https` accessible publiquement

Vérifiez Node.js :

```bash
node --version   # doit afficher v22.x ou plus
npm --version
```

---

## 3. Installation pas à pas

Toutes les commandes se lancent **depuis le dossier `backend/`** :

```bash
cd backend
```

### 3.1 Installer Node.js et les dépendances

```bash
npm install
```

Cela installe `wrangler`, l'outil en ligne de commande de Cloudflare (l'équivalent de
`git` mais pour les Workers). Il n'y a rien d'autre à installer.

### 3.2 Se connecter à Cloudflare

```bash
npx wrangler login
```

Une page s'ouvre dans votre navigateur : autorisez Wrangler. Pour vérifier :

```bash
npx wrangler whoami
```

> Cette connexion ne sert qu'à **créer le KV et déployer**. Le mode local
> (`npm run dev`) fonctionne sans compte Cloudflare, sans connexion et même hors ligne :
> vous pouvez tester le Worker avant de vous connecter.

### 3.3 Créer le stockage KV

```bash
npm run kv:create
```

Sortie (les identifiants sont différents chez vous) :

```
✅ Successfully created namespace "deblock-status-api-STATUS_KV"
[[kv_namespaces]]
binding = "STATUS_KV"
id = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
```

Copiez l'`id` et collez-le dans **`wrangler.jsonc`**, à la place de
`REPLACEZ_PAR_L_ID_KV` :

```jsonc
"kv_namespaces": [
  {
    "binding": "STATUS_KV",
    "id": "a1b2c3d4e5f60718293a4b5c6d7e8f90"
  }
]
```

> Sans cette étape, le déploiement échoue avec une erreur du type
> « KV namespace not found ». C'est l'erreur la plus fréquente au premier essai.

### 3.4 Tester en local

```bash
npm run dev
```

Le terminal affiche `Ready on http://localhost:8787`. Dans un navigateur (ou avec `curl`) :

```bash
curl http://localhost:8787/api/status
```

Vous devez recevoir un JSON avec vos services. Comme le cron ne tourne pas encore en
local, l'API teste les services à la volée (`"source": "live"`).

Les scripts `dev` et `dev:cron` forcent le **mode local** (`wrangler dev --local`) :
le Worker tourne sur votre machine, avec un KV local, et n'essaie pas de joindre
Cloudflare. C'est volontaire : le mode distant exige un sous-domaine `workers.dev`
configuré et n'apporte rien pour développer.

Pour simuler un passage du cron (et donc remplir l'historique local) :

```bash
npm run dev:cron
# dans un autre terminal :
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

Relancez ensuite `/api/status` : `"source"` devient `"kv"` et l'historique grandit
à chaque déclenchement. Les données locales sont stockées dans `backend/.wrangler/`
(supprimable à tout moment).

Arrêtez le serveur local avec `Ctrl + C`.

### 3.5 Déployer

```bash
npm run deploy
```

Sortie :

```
Uploaded deblock-status-api
Deployed deblock-status-api triggers
  https://deblock-status-api.VOTRE-SOUS-DOMAINE.workers.dev
```

C'est en ligne. Le premier passage du cron arrive dans les 5 minutes ; en attendant,
l'API répond en mode `live`.

Commandes utiles ensuite :

```bash
npm run logs     # suivre les logs du Worker en direct
npm run deploy   # redéployer après une modification
```

### 3.6 Brancher la page de statut

Ouvrez `js/config.js` à la racine du dépôt et remplacez l'URL par celle de votre Worker,
en ajoutant `/api/status` :

```js
window.STATUS_CONFIG = {
  apiUrl: "https://deblock-status-api.VOTRE-SOUS-DOMAINE.workers.dev/api/status",
  refreshSeconds: 60,
  demoFallback: true,
};
```

Rechargez la page : les données réelles remplacent la démonstration.

Si votre front est servi depuis un autre domaine, restreignez les origines autorisées
dans `wrangler.jsonc` puis redéployez :

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "https://status.deblock-studios.fr,https://deblock-studios.fr"
}
```

`"*"` (valeur par défaut) autorise tous les sites : acceptable pour des données
publiques en lecture seule, mais moins propre.

---

## 4. Gérer la liste des services

Éditez [`services.json`](services.json), puis **redéployez** (`npm run deploy`) :
le fichier est embarqué dans le Worker au moment du déploiement.

```json
[
  {
    "id": "mon-site",
    "name": "Mon site",
    "description": "Site vitrine principal",
    "url": "https://exemple.fr",
    "category": "Sites & outils",
    "method": "GET",
    "expectedStatus": [200],
    "expectBody": "Bienvenue",
    "timeoutMs": 10000,
    "degradedMs": 2500
  }
]
```

| Champ | Obligatoire | Rôle | Défaut |
| --- | --- | --- | --- |
| `id` | non | Identifiant unique (minuscules, tirets). Sert de clé dans l'historique. | dérivé du nom |
| `name` | oui | Nom affiché sur la page. | — |
| `url` | oui | URL testée (`https://…`). | — |
| `description` | non | Petite phrase sous le nom. | vide |
| `category` | non | Groupe d'affichage (« Sites & outils », « Infrastructure »…). | `Services` |
| `method` | non | `GET` ou `HEAD`. | `GET` |
| `expectedStatus` | non | Code(s) HTTP considérés comme OK : `200` ou `[200, 301, 302]`. | `200–399` |
| `expectBody` | non | Texte qui doit apparaître dans la réponse (utile pour détecter une page d'erreur servie en 200). | aucun |
| `timeoutMs` | non | Délai maximum avant échec, entre 1 000 et 25 000 ms. | `10000` |
| `degradedMs` | non | Au-delà de cette latence, le service est marqué **ralenti**. | `2500` |

> **Attention au `id`** : si vous le changez, l'historique du service repart de zéro
> (l'ancien reste en KV sous l'ancien id, sans effet).

> **Sites protégés** : un site derrière un pare-feu anti-bot (Cloudflare Challenge,
> captcha…) peut renvoyer `403` au Worker même s'il s'ouvre dans votre navigateur.
> Dans ce cas, le service apparaîtra indisponible : surveillez plutôt une URL d'API
> ou une page non protégée.

---

## 5. Comprendre le fonctionnement

### Le cycle de vérification

1. Le cron Cloudflare appelle le Worker (toutes les 5 minutes, en **UTC**).
2. Chaque service est testé, **6 en parallèle** au maximum, avec un `AbortController`
   pour couper les requêtes trop lentes.
3. Un service est :
   - **opérationnel** : code HTTP attendu et latence < `degradedMs` ;
   - **ralenti** : réponse correcte mais latence ≥ `degradedMs` ;
   - **indisponible** : timeout, erreur réseau, code HTTP inattendu ou `expectBody` absent.
4. Le résultat est ajouté à l'historique et écrit dans KV sous la clé
   `status:snapshot:v1` (une seule écriture par passage, quel que soit le nombre de services).
5. `GET /api/status` relit ce snapshot et le présente à la page.

### Ce qui est conservé

| Donnée | Détail |
| --- | --- |
| Dernière vérification | Code HTTP, latence, message d'erreur, horodatage |
| Historique court | Les 60 dernières vérifications par service (≈ 5 h à 5 min d'intervalle) |
| Historique journalier | Nombre de tests OK / total par jour, sur 90 jours |
| Disponibilité | Calculée sur 24 h, 7 jours et 30 jours à partir des compteurs journaliers |

### Statut global

`down` si au moins un service est indisponible, sinon `degraded` si au moins un est
ralenti, sinon `operational`.

---

## 6. Référence de l'API

Base : `https://<nom-du-worker>.<sous-domaine>.workers.dev`

| Méthode | Chemin | Réponse |
| --- | --- | --- |
| `GET` | `/` | Nom du Worker, version, liste des endpoints |
| `GET` | `/api/health` | `{ "ok": true, "time": "…" }` |
| `GET` | `/api/status` | État complet de tous les services |
| `OPTIONS` | toutes | Préflight CORS |

En-têtes : `Cache-Control: public, max-age=30, s-maxage=60` (30 s de cache côté navigateur).

Extrait de réponse :

```json
{
  "updatedAt": "2026-11-07T10:03:30.600Z",
  "source": "kv",
  "intervalMinutes": 5,
  "summary": {
    "status": "operational",
    "total": 5,
    "operational": 5,
    "degraded": 0,
    "down": 0,
    "unknown": 0,
    "avgLatencyMs": 224,
    "uptime": { "day": 100, "week": 99.98, "month": 99.95 }
  },
  "services": [
    {
      "id": "multicraft-info",
      "name": "MultiCraft Info",
      "description": "Documentation et infos sur les serveurs Minecraft",
      "url": "https://multicraft-info.netlify.app",
      "category": "Sites & outils",
      "status": "operational",
      "latencyMs": 190,
      "httpStatus": 200,
      "error": null,
      "checkedAt": "2026-11-07T10:03:29.000Z",
      "uptime": { "day": 100, "week": 100, "month": 100 },
      "history": [{ "at": 1794045802803, "ok": true, "latencyMs": 190 }]
    }
  ]
}
```

Valeurs de `status` : `operational`, `degraded`, `down`, `unknown`.
`uptime` vaut `null` tant qu'aucune mesure n'existe pour la période.
`source` vaut `live` quand l'API teste à la volée (pas encore de snapshot KV).

---

## 7. Configuration (`wrangler.jsonc`)

```jsonc
{
  "name": "deblock-status-api",          // nom du Worker → <nom>.<sous-domaine>.workers.dev
  "main": "src/index.js",                // point d'entrée
  "compatibility_date": "2026-11-01",    // version du runtime (ne pas dater dans le futur)
  "workers_dev": true,                   // URL *.workers.dev activée
  "observability": { "enabled": true },  // logs visibles dans le dashboard
  "triggers": { "crons": ["*/5 * * * *"] },
  "vars": { "ALLOWED_ORIGINS": "*" },
  "kv_namespaces": [{ "binding": "STATUS_KV", "id": "…" }]
}
```

### Changer la fréquence

```jsonc
"triggers": { "crons": ["* * * * *"] }   // toutes les minutes (minimum Cloudflare)
```

Après modification, relancez `npm run deploy`. Cloudflare exécute les crons en **UTC**
et peut décaler de quelques secondes. Si vous changez la fréquence, mettez aussi à jour
`CHECK_INTERVAL_MINUTES` en haut de `src/index.js` (affiché sur la page) et sachez que
les barres d'historique représentent toujours 60 vérifications.

### Variables

| Variable | Rôle |
| --- | --- |
| `ALLOWED_ORIGINS` | Liste d'origines séparées par des virgules, ou `*`. Contrôle l'en-tête CORS. |

Pour ajouter un secret (non nécessaire ici), utilisez `npx wrangler secret put NOM`
— ne mettez **jamais** de clé privée dans `wrangler.jsonc` ni dans `services.json`.

---

## 8. Limites et coûts

Tout tient dans l'offre gratuite de Cloudflare pour un usage normal :

| Ressource | Offre gratuite | Consommation à 5 min d'intervalle |
| --- | --- | --- |
| Requêtes Worker | 100 000 / jour | 288 crons/jour + visites de la page |
| Écritures KV | 1 000 / jour | 288 / jour (1 par passage du cron) |
| Lectures KV | 100 000 / jour | 1 par appel `/api/status` |
| Stockage KV | 1 Go | quelques Ko |
| Sous-requêtes par exécution | 50 | 1 par service |

Ordres de grandeur :

- à **1 minute** d'intervalle : 1 440 écritures KV/jour → toujours sous la limite gratuite ;
- au-delà de **~45 services**, réduisez la fréquence ou passez à l'offre payante
  (5 $/mois), la limite de sous-requêtes par exécution étant de 50 en gratuit ;
- un cron toutes les 5 minutes suffit largement pour une page de statut.

Cloudflare KV est **à cohérence éventuelle** : une écriture peut mettre jusqu'à
~60 secondes à être visible partout. C'est normal, ce n'est pas un bug.

---

## 9. Dépannage

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| `KV namespace not found` au déploiement | L'`id` du KV n'a pas été remplacé dans `wrangler.jsonc` | Relancez `npm run kv:create` et collez le bon `id` |
| `/api/status` renvoie `source: "live"` en permanence | Le cron ne s'est pas encore exécuté, ou l'écriture KV échoue | Attendez 5 min, lancez `npm run logs`, vérifiez le binding `STATUS_KV` |
| Les services sont tous `down` | Le Worker est bloqué par un pare-feu, ou l'URL est mauvaise | Testez l'URL avec `curl -A "DeblockStatus/1.0" <url>` ; vérifiez `expectedStatus` |
| `HTTP 403` sur un site qui marche au navigateur | Protection anti-bot (Cloudflare, captcha) | Surveillez une autre URL ou ajoutez le statut attendu |
| « Délai dépassé (10000 ms) » | Site lent ou injoignable | Augmentez `timeoutMs` (max 25 000), vérifiez le service |
| La page affiche « Mode démonstration » | `js/config.js` contient encore l'URL d'exemple, ou l'API est injoignable | Collez l'URL réelle du Worker, terminez par `/api/status` |
| Erreur CORS dans la console du navigateur | `ALLOWED_ORIGINS` ne contient pas le domaine du front | Ajoutez le domaine exact (avec `https://`, sans slash final) puis redéployez |
| Les chiffres ne bougent pas | Cache navigateur/API de 30 s, ou cron en retard | Attendez ~1 min, cliquez sur « Actualiser » |
| `npm install` échoue sur Node | Version de Node trop ancienne | Installez Node.js 22 LTS |
| `wrangler login` n'ouvre rien (serveur distant) | Pas de navigateur disponible | Lancez la commande sur votre machine locale |
| `You need to register a workers.dev subdomain before running the dev command in remote mode` | `wrangler dev` a basculé en mode distant (option `--remote` ou binding KV marqué `remote: true`) | `npm run dev` force `--local` ; sinon lancez `npx wrangler dev --local`. Le mode distant exige un sous-domaine `workers.dev` (Dashboard → Workers & Pages → Onboarding) |
| Deux bindings KV s'affichent au démarrage, dont un nommé `deblock_status_api_STATUS_KV` | Wrangler a provisionné un namespace lors d'un essai en mode distant, ou une entrée a été ajoutée à la main | Supprimez l'entrée en trop dans `wrangler.jsonc` et gardez un seul `STATUS_KV` avec l'`id` réel (`git diff backend/wrangler.jsonc` pour voir la différence) |

Afficher les logs en direct :

```bash
npm run logs
```

Tester une URL comme le Worker :

```bash
curl -I -A "DeblockStatus/1.0 (+https://github.com/Deblock-Studios/DeblockStatus)" https://exemple.fr
```

---

## 10. Sécurité

- L'API est **publique et en lecture seule** : aucun secret, aucune donnée privée.
- Aucune entrée utilisateur n'est acceptée : les URL testées viennent uniquement de
  `services.json`, qui fait partie du code déployé. Pas de risque de SSRF piloté
  par un visiteur.
- Aucun paramètre d'URL ne déclenche de vérification : le cron est la seule source
  d'écriture, ce qui évite de consommer le quota KV à la demande.
- Les réponses sont mises en cache 30 s et les erreurs internes sont remplacées par un
  message générique (`Service injoignable…`) : pas de fuite d'information technique.
- Pour verrouiller l'accès, restreignez `ALLOWED_ORIGINS` à vos domaines. Un en-tête
  CORS n'est pas une authentification : ne publiez jamais de données sensibles ici.

---

## 11. Structure des fichiers

```
backend/
├── README.md          ← ce guide
├── package.json       ← scripts npm + version de Wrangler
├── package-lock.json  ← versions exactes (à committer)
├── wrangler.jsonc     ← configuration Cloudflare (nom, cron, KV, CORS)
├── services.json      ← 📋 liste des services surveillés
├── .gitignore         ← node_modules, .wrangler, .dev.vars
└── src/
    └── index.js       ← code du Worker (fetch + scheduled)
```

Le code du Worker tient dans un seul fichier, commenté en français :

- `fetch()` : routes HTTP (`/`, `/api/health`, `/api/status`) ;
- `scheduled()` : appelé par le cron, lance les tests et écrit dans KV ;
- `checkService()` : un test (timeout, code HTTP, latence, contenu attendu) ;
- `present()` : transforme le snapshot KV en réponse publique avec uptimes.

---

## 12. Aide-mémoire des commandes

| Commande | Effet |
| --- | --- |
| `npm install` | Installe Wrangler |
| `npx wrangler login` | Connecte le terminal à votre compte Cloudflare |
| `npm run kv:create` | Crée le namespace KV et affiche son `id` |
| `npm run dev` | Lance le Worker en local sur <http://localhost:8787> (mode `--local`) |
| `npm run dev:cron` | Idem, avec possibilité de simuler le cron |
| `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` | Déclenche un passage du cron en local |
| `npm run deploy` | Déploie (ou met à jour) le Worker et ses crons |
| `npm run logs` | Suit les logs de production en direct |
| `npx wrangler whoami` | Vérifie le compte connecté |
| `npx wrangler deployments list` | Historique des déploiements |

---

Une question, un service à ajouter ? Ouvrez une issue sur
[le dépôt GitHub](https://github.com/Deblock-Studios/DeblockStatus).
