/* ═══════════════════════════════════════════════════════════
   Configuration de la page de statut
   ───────────────────────────────────────────────────────────
   ➜ Remplacez apiUrl par l'URL de VOTRE Worker Cloudflare
     (celle affichée par `npm run deploy`, + /api/status).
   ═══════════════════════════════════════════════════════════ */

window.STATUS_CONFIG = {
  // Exemple : "https://deblock-status-api.mon-sous-domaine.workers.dev/api/status"
  apiUrl: "https://deblock-status-api.recuperer22compte.workers.dev/",

  // Rafraîchissement automatique de la page (en secondes). 0 = désactivé.
  refreshSeconds: 60,

  // Si l'API est injoignable ou pas encore configurée, afficher des
  // données de démonstration (clairement signalées) au lieu d'une page vide.
  demoFallback: false,
};
