# Deblock Status

Page de statut publique des projets **Deblock Studios**, avec un backend
**Cloudflare Worker** qui teste automatiquement chaque service et conserve
l'historique de disponibilité.

- **Front** : site statique (`index.html`, `css/`, `js/`), sans framework ni build.
- **Back** : Worker Cloudflare (`backend/`) déclenché par un cron, résultats servis en JSON.
- **Design** : réutilise le design system du site Deblock Studios (`css/main.css`).

## Aperçu

La page affiche :

- un bandeau global (tout va bien / service ralenti / incident en cours) ;
- la disponibilité 24 h, le nombre de services et la latence moyenne ;
- une carte par service, groupée par catégorie, avec latence, uptime 24 h / 7 j / 30 j
  et l'historique des dernières vérifications ;
- les incidents récents, reconstitués à partir de l'historique.

Si l'API n'est pas encore configurée ou est injoignable, la page bascule sur des
**données de démonstration clairement signalées** au lieu d'afficher une page vide.

## Structure du dépôt

```
.
├── index.html            # page de statut
├── css/
│   ├── main.css          # design system Deblock Studios (repris tel quel)
│   └── status.css        # composants propres à la page de statut
├── js/
│   ├── config.js         # ⚙️ URL de l'API (à modifier après le déploiement)
│   └── app.js            # récupération des données + rendu
├── images/
│   └── logo-deblock.svg
└── backend/              # Worker Cloudflare (voir backend/README.md)
    ├── services.json     # 📋 liste des services à surveiller
    ├── src/index.js      # code du Worker
    ├── wrangler.jsonc    # configuration Cloudflare
    └── README.md         # guide pas à pas (débutant)
```

## Démarrage rapide

### 1. Le backend

Suivez **[backend/README.md](backend/README.md)** : création du compte Cloudflare,
du stockage KV, déploiement du Worker et récupération de son URL.

### 2. Le front

Dans `js/config.js`, remplacez l'URL d'exemple par celle de votre Worker :

```js
window.STATUS_CONFIG = {
  apiUrl: "https://deblock-status-api.mon-sous-domaine.workers.dev/api/status",
  refreshSeconds: 60,
  demoFallback: true,
};
```

### 3. Test en local

Le site est 100 % statique, n'importe quel serveur de fichiers fait l'affaire :

```bash
npx serve .
# ou : python3 -m http.server 3000
```

Sans URL d'API valide, la page s'affiche en mode démonstration (`?demo=1` force ce mode).

### 4. Mise en ligne du front

**Cloudflare Pages** (recommandé) :

1. Dashboard Cloudflare → *Workers & Pages* → *Create* → *Pages* → *Upload assets*.
2. Déposez le dossier du site (sans `backend/` ni `node_modules`, inutiles côté front).
3. Aucune commande de build, aucun framework : la racine du dépôt est le site.

Cela fonctionne aussi tel quel sur GitHub Pages, Netlify ou Vercel (site statique).

⚠️ Pensez ensuite à restreindre les origines autorisées côté Worker
(`ALLOWED_ORIGINS` dans `backend/wrangler.jsonc`) au domaine réel du front.

## Ajouter ou retirer un service

Tout se passe dans [`backend/services.json`](backend/services.json), puis :

```bash
cd backend && npm run deploy
```

La liste fait partie du code déployé : une modification locale ne sera pas visible
en production tant que vous n'avez pas redéployé. Les champs disponibles sont
documentés dans le [README du backend](backend/README.md#gérer-la-liste-des-services).

## Personnalisation

- Couleurs, typographie, boutons : `css/main.css` (design system du studio).
- Composants du statut (cartes, pastilles, barres) : `css/status.css`.
- Textes de la page : `index.html` et `js/app.js` (messages du bandeau global).
- Fréquence des tests : `triggers.crons` dans `backend/wrangler.jsonc` (5 min par défaut).

## Crédits

- Design system et logo : [Deblock Studios](https://github.com/Deblock-Studios/website).
- Supervision : Cloudflare Workers, Cron Triggers et Workers KV.
