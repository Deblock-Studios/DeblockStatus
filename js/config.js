/* ═══════════════════════════════════════════════════════════
   Configuration de la page de statut
   ───────────────────────────────────────────────────────────
   ➜ apiUrl doit pointer vers l'endpoint /api/status du Worker
     (pas la racine : elle renvoie la liste des endpoints).
   ═══════════════════════════════════════════════════════════ */

window.STATUS_CONFIG = {
  apiUrl: "https://deblock-status-api.recuperer22compte.workers.dev/api/status",

  // Rafraîchissement automatique de la page (en secondes). 0 = désactivé.
  refreshSeconds: 60,

  // Si l'API est injoignable, afficher des données de démonstration
  // (clairement signalées) au lieu d'un message d'erreur.
  // false = on affiche l'erreur, sans risque de faire passer des données
  // fictives pour l'état réel des services.
  demoFallback: false,
};
