/* ═══════════════════════════════════════════════════════════
   Deblock Status — logique de la page
   Lit js/config.js, interroge le Worker et affiche l'état.
   ═══════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  const config = Object.assign(
    { apiUrl: "", refreshSeconds: 60, demoFallback: true },
    window.STATUS_CONFIG || {},
  );

  const state = {
    data: null,
    demo: false,
    loading: false,
    lastFetchError: null,
  };

  const $ = (id) => document.getElementById(id);

  const STATUS_LABEL = {
    operational: "Opérationnel",
    degraded: "Ralenti",
    down: "Indisponible",
    unknown: "Inconnu",
  };

  const SLOW_MS = 2500;
  const HEARTBEATS = 60;
  const forcedDemo = new URLSearchParams(window.location.search).get("demo") === "1";

  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const timeFormat = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  });

  // ── Démarrage ────────────────────────────────────────────

  init();

  function init() {
    $("refresh").addEventListener("click", () => refresh({ manual: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      const age = state.data ? Date.now() - new Date(state.data.updatedAt).getTime() : Infinity;
      if (age > intervalMs()) refresh();
    });

    if (config.refreshSeconds > 0) {
      window.setInterval(() => {
        if (!document.hidden) refresh();
      }, intervalMs());
    }
    window.setInterval(updateRelativeTimes, 15000);

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const apiLink = $("api-link");
    if (apiLink && apiConfigured()) {
      apiLink.href = apiUrl();
      apiLink.target = "_blank";
      apiLink.rel = "noopener";
      apiLink.textContent = "API (JSON)";
    }

    refresh();
  }

  function intervalMs() {
    const seconds = Number(config.refreshSeconds) || 60;
    return Math.max(15, seconds) * 1000;
  }

  function onScroll() {
    $("nav").classList.toggle("scrolled", window.scrollY > 12);
  }

  // ── Chargement ───────────────────────────────────────────

  function apiUrl() {
    return String(config.apiUrl || "").trim();
  }

  function apiConfigured() {
    const url = apiUrl();
    if (!url) return false;
    if (url.startsWith("/")) return true; // même domaine (Worker routé sur /api/*)
    if (!/^https?:\/\/\S+$/i.test(url)) return false;
    return !/VOTRE|votre-sous-domaine|example\.com/i.test(url);
  }

  async function refresh({ manual = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const button = $("refresh");
    button.classList.add("is-busy");

    if (manual) {
      button.setAttribute("aria-busy", "true");
    }

    try {
      if (forcedDemo) {
        showDemo(null);
        return;
      }
      if (!apiConfigured()) {
        showDemo("not-configured");
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let payload;
      try {
        const response = await fetch(apiUrl(), {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        payload = await response.json();
      } finally {
        clearTimeout(timer);
      }

      if (!payload || !Array.isArray(payload.services)) {
        throw new Error("Réponse de l'API invalide");
      }

      state.data = payload;
      state.demo = false;
      state.lastFetchError = null;
      hideNotice();
      render();
    } catch (error) {
      state.lastFetchError = error;
      if (state.data && !state.demo) {
        // On garde la dernière mesure connue plutôt que d'inventer des données.
        render();
        showNotice(
          `<strong>Actualisation impossible.</strong> ${escapeHtml(
            (error && error.message) || "erreur réseau",
          )} — les dernières données reçues restent affichées.`,
        );
      } else if (config.demoFallback) {
        showDemo("unreachable", error);
      } else {
        renderError(error);
      }
    } finally {
      state.loading = false;
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
    }
  }

  function showDemo(reason, error) {
    state.data = demoPayload();
    state.demo = true;
    render();

    if (reason === "not-configured") {
      showNotice(
        `<strong>Mode démonstration.</strong> L'API de supervision n'est pas encore configurée :
         renseignez l'URL de votre Worker dans <code>js/config.js</code>.
         Les chiffres affichés ci-dessous sont fictifs.`,
      );
    } else if (reason === "unreachable") {
      showNotice(
        `<strong>API injoignable.</strong> ${escapeHtml(
          (error && error.message) || "erreur réseau",
        )} — données de démonstration affichées. Vérifiez l'URL dans <code>js/config.js</code> et que le Worker est déployé.`,
      );
    } else {
      showNotice(
        `<strong>Mode démonstration activé via l'URL</strong> (<code>?demo=1</code>). Les données affichées sont fictives : retirez le paramètre pour revenir au direct.`,
      );
    }

    updateRelativeTimes();
  }

  function showNotice(html) {
    const notice = $("notice");
    notice.innerHTML = html;
    notice.hidden = false;
  }

  function hideNotice() {
    const notice = $("notice");
    notice.hidden = true;
    notice.innerHTML = "";
  }

  function renderError(error) {
    state.data = null;
    $("overall").dataset.status = "unknown";
    const dot = $("overall-dot");
    dot.dataset.status = "unknown";
    $("overall-title").textContent = "Statut indisponible";
    $("overall-sub").textContent =
      "Impossible de contacter l'API de supervision. Réessayez dans quelques instants.";
    $("updated").innerHTML = "<strong>—</strong> dernière vérification";
    ["stat-uptime", "stat-total", "stat-incidents", "stat-latency"].forEach((id) => {
      $(id).textContent = "—";
    });
    $("services-list").innerHTML =
      '<div class="empty">Aucune donnée à afficher pour le moment.</div>';
    $("incidents-list").innerHTML =
      '<div class="empty">Aucune donnée à afficher pour le moment.</div>';
    showNotice(
      `<strong>Erreur de connexion.</strong> ${escapeHtml(
        (error && error.message) || "requête échouée",
      )}.`,
    );
    $("footer-status").textContent = "Supervision momentanément indisponible.";
    document.title = "Statut indisponible — Deblock Status";
  }

  // ── Rendu ────────────────────────────────────────────────

  function render() {
    const data = state.data;
    if (!data) return;

    const summary = data.summary || {};
    const status = normalizeStatus(summary.status);

    const overall = $("overall");
    overall.dataset.status = status;
    $("overall-dot").dataset.status = status;

    const title = $("overall-title");
    const sub = $("overall-sub");
    const down = Number(summary.down) || 0;
    const degraded = Number(summary.degraded) || 0;

    if (status === "operational") {
      title.textContent = "Tous les services fonctionnent normalement";
      sub.textContent = `Vérification automatique toutes les ${data.intervalMinutes || 5} minutes. Aucun incident détecté.`;
    } else if (status === "degraded") {
      title.textContent =
        degraded > 1 ? `${degraded} services ralentis` : "Un service est ralenti";
      sub.textContent =
        "Les services restent accessibles, mais les temps de réponse sont anormalement élevés.";
    } else if (status === "down") {
      title.textContent =
        down > 1 ? `${down} services indisponibles` : "Un service est indisponible";
      sub.textContent = "Incident en cours, une vérification est relancée automatiquement.";
    } else {
      title.textContent = "Aucune mesure disponible";
      sub.textContent =
        "L'API répond mais aucun service n'a encore été vérifié. Réessayez dans quelques minutes.";
    }

    $("stat-uptime").textContent = formatPct(summary.uptime && summary.uptime.day);
    $("stat-total").textContent = String(summary.total ?? (data.services || []).length);
    $("stat-incidents").textContent = String(down + degraded);
    $("stat-latency").textContent = formatMs(summary.avgLatencyMs);

    renderServices(data.services || []);
    renderIncidents(data.services || []);
    updateRelativeTimes();

    $("footer-status").textContent = state.demo
      ? "Mode démonstration — données fictives."
      : `Supervision active — ${summary.total || 0} services suivis toutes les ${
          data.intervalMinutes || 5
        } min.`;

    document.title = `${statusText(status)} — Deblock Status`;
  }

  function statusText(status) {
    if (status === "operational") return "Tous les services opérationnels";
    if (status === "degraded") return "Services ralentis";
    if (status === "down") return "Incident en cours";
    return "Statut inconnu";
  }

  function updateRelativeTimes() {
    if (!state.data) return;
    const date = new Date(state.data.updatedAt);
    if (Number.isNaN(date.getTime())) return;
    $("updated").innerHTML = `<strong>${escapeHtml(
      relativeTime(date.getTime()),
    )}</strong> dernière vérification`;
    $("updated").title = dateTimeFormat.format(date);
  }

  function renderServices(services) {
    const container = $("services-list");
    if (!services.length) {
      container.innerHTML =
        '<div class="empty">Aucun service configuré pour le moment.</div>';
      return;
    }

    const groups = new Map();
    for (const service of services) {
      const category = service.category || "Services";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(service);
    }

    container.innerHTML = Array.from(groups.entries())
      .map(
        ([category, items]) => `
        <div class="services-group">
          <h3 class="group-label">${escapeHtml(category)}</h3>
          <div class="services-grid">
            ${items.map(serviceCard).join("")}
          </div>
        </div>`,
      )
      .join("");
  }

  function serviceCard(service) {
    const status = normalizeStatus(service.status);
    const history = Array.isArray(service.history) ? service.history : [];
    const beats = heartbeatSlots(history, Number(service.latencyMs) || 0);
    const errorHtml = service.error
      ? `<p class="service-error">${escapeHtml(service.error)}</p>`
      : "";
    const providersHtml =
      Array.isArray(service.providers) && service.providers.length
        ? `<div class="provider-list">
             <span class="provider-list-label">Fournisseurs IA</span>
             ${service.providers.map(providerRow).join("")}
           </div>`
        : "";

    const name = escapeHtml(service.name || service.id);
    const heading = service.url
      ? `<a href="${escapeAttribute(service.url)}" target="_blank" rel="noopener">${name}</a>`
      : `<span class="service-name-private">${name}</span>`;

    return `
      <article class="service-card" data-status="${status}">
        <div class="service-head">
          <div>
            <h3 class="service-name">
              ${heading}
            </h3>
            ${
              service.description
                ? `<p class="service-desc">${escapeHtml(service.description)}</p>`
                : ""
            }
          </div>
          <span class="status-chip">
            <span class="status-dot" data-status="${status}" aria-hidden="true"></span>
            ${STATUS_LABEL[status]}
          </span>
        </div>
        ${errorHtml}
        ${providersHtml}
        <div class="service-meta">
          <div class="meta" title="${escapeAttribute(
            service.httpStatus ? `Dernier code HTTP : ${service.httpStatus}` : "Code HTTP inconnu",
          )}">
            <b>${formatMs(service.latencyMs)}</b>
            <span>Latence</span>
          </div>
          <div class="meta">
            <b>${formatPct(service.uptime && service.uptime.day)}</b>
            <span>24 h</span>
          </div>
          <div class="meta">
            <b>${formatPct(service.uptime && service.uptime.week)}</b>
            <span>7 jours</span>
          </div>
          <div class="meta">
            <b>${formatPct(service.uptime && service.uptime.month)}</b>
            <span>30 jours</span>
          </div>
        </div>
        <div class="heartbeat" role="img" aria-label="Historique des ${history.length} dernières vérifications">
          ${beats}
        </div>
        <div class="heartbeat-caption">
          <span>il y a ${relativeShort(history.length, state.data.intervalMinutes)}</span>
          <span>maintenant</span>
        </div>
      </article>`;
  }

  function providerRow(provider) {
    const status = normalizeStatus(provider.status);
    const role = provider.role === "fallback" ? "fallback" : "primary";
    const roleLabel = role === "fallback" ? "Fallback" : "Principal";
    const details = [];
    if (provider.detail) details.push(provider.detail);
    if (provider.avgMs != null) details.push(`${formatMs(provider.avgMs)} en moyenne`);
    if (provider.successRate != null) {
      details.push(`${nf.format(provider.successRate)}\u00a0% de réussite`);
    }

    return `
      <div class="provider-row" data-status="${status}">
        <span class="provider-role" data-role="${role}">${roleLabel}</span>
        <div class="provider-main">
          <span class="provider-name">${escapeHtml(provider.name || provider.id)}</span>
          <code class="provider-model">${escapeHtml(provider.model || "modèle inconnu")}</code>
        </div>
        <span class="provider-state">
          <span class="status-dot" data-status="${status}" aria-hidden="true"></span>
          ${STATUS_LABEL[status]}
        </span>
        ${
          details.length
            ? `<span class="provider-detail">${escapeHtml(details.join(" · "))}</span>`
            : ""
        }
      </div>`;
  }

  function heartbeatSlots(history, currentLatency) {
    const recent = history.slice(-HEARTBEATS);
    const slots = [];
    const missing = HEARTBEATS - recent.length;

    for (let index = 0; index < missing; index += 1) {
      slots.push('<span class="beat is-empty" aria-hidden="true"></span>');
    }

    recent.forEach((check, index) => {
      const isLast = index === recent.length - 1;
      const latency = Number(check.latencyMs) || (isLast ? currentLatency : 0);
      const status = !check.ok ? "down" : latency >= SLOW_MS ? "degraded" : "up";
      const label = !check.ok
        ? "indisponible"
        : latency >= SLOW_MS
          ? `ralenti (${formatMs(latency)})`
          : `opérationnel (${formatMs(latency)})`;
      slots.push(
        `<span class="beat is-${status}" title="${escapeAttribute(
          `${formatTime(check.at)} — ${label}`,
        )}" aria-hidden="true"></span>`,
      );
    });

    return slots.join("");
  }

  function renderIncidents(services) {
    const incidents = [];

    for (const service of services) {
      const history = Array.isArray(service.history) ? service.history : [];
      let current = null;

      history.forEach((check, index) => {
        if (!check.ok) {
          if (!current) current = { start: check.at, end: check.at, checks: 0 };
          current.end = check.at;
          current.checks += 1;
          current.ongoing = index === history.length - 1 && normalizeStatus(service.status) === "down";
        } else if (current) {
          incidents.push({ service, ...current });
          current = null;
        }
      });
      if (current) incidents.push({ service, ...current });
    }

    incidents.sort((a, b) => b.start - a.start);
    const container = $("incidents-list");

    if (!incidents.length) {
      container.innerHTML =
        '<div class="empty">Aucun incident détecté sur les dernières vérifications. Tout est calme dans la forge.</div>';
      return;
    }

    container.innerHTML = incidents
      .slice(0, 8)
      .map((incident) => {
        const ongoing = Boolean(incident.ongoing);
        const duration = Math.max(0, incident.end - incident.start);
        const durationLabel = duration >= 60000 ? `${Math.round(duration / 60000)} min` : "< 1 min";
        const detail = ongoing
          ? escapeHtml(incident.service.error || "Vérifications en échec")
          : `${incident.checks} vérification${incident.checks > 1 ? "s" : ""} en échec · ${durationLabel}`;

        return `
          <article class="incident${ongoing ? " is-ongoing" : ""}">
            <span class="incident-bar" aria-hidden="true"></span>
            <div class="incident-body">
              <h4>
                ${escapeHtml(incident.service.name || incident.service.id)}
                <span class="tag">${ongoing ? "En cours" : "Résolu"}</span>
              </h4>
              <p>${detail}</p>
            </div>
            <time datetime="${new Date(incident.start).toISOString()}">${formatTime(
              incident.start,
            )}</time>
          </article>`;
      })
      .join("");
  }

  // ── Formatage ────────────────────────────────────────────

  function normalizeStatus(status) {
    return STATUS_LABEL[status] ? status : "unknown";
  }

  function formatPct(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    return `${nf.format(Number(value))}\u00a0%`;
  }

  function formatMs(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    const ms = Math.max(0, Number(value));
    if (ms < 1000) return `${Math.round(ms)}\u00a0ms`;
    return `${nf.format(Math.round(ms / 100) / 10)}\u00a0s`;
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "—" : timeFormat.format(date);
  }

  function relativeTime(timestamp) {
    const seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 10) return "à l'instant";
    if (seconds < 60) return `il y a ${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.round(hours / 24);
    return `il y a ${days} j`;
  }

  function relativeShort(checks, intervalMinutes) {
    const step = Number(intervalMinutes) || 5;
    const minutes = Math.max(0, checks - 1) * step;
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 6) / 10;
    return `${nf.format(hours)} h`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  // ── Données de démonstration ─────────────────────────────
  // Utilisées uniquement si l'API n'est pas configurée / joignable.

  function demoPayload() {
    const now = Date.now();
    const random = mulberry32(20261107);

    const defs = [
      {
        id: "multicraft-info",
        name: "MultiCraft Info",
        description: "Documentation et infos sur les serveurs Minecraft",
        url: "https://multicraft-info.netlify.app",
        category: "Sites & outils",
        base: 175,
        slowAt: [],
        downAt: [],
        uptime: { day: 100, week: 99.97, month: 99.93 },
      },
      {
        id: "multidb",
        name: "MultiDB",
        description: "Base de données communautaire MultiCraft",
        url: "https://multidb.vercel.app",
        category: "Sites & outils",
        base: 210,
        slowAt: [],
        downAt: [],
        uptime: { day: 100, week: 99.91, month: 99.88 },
      },
      {
        id: "deblockcord",
        name: "DeblockCord",
        description: "Site de la communauté Discord",
        url: "https://deblockcord.netlify.app/",
        category: "Communauté",
        base: 148,
        slowAt: [],
        downAt: [],
        uptime: { day: 100, week: 100, month: 99.99 },
      },
      {
        id: "blog",
        name: "Blog Deblock Studios",
        description: "Articles et actualités du studio",
        url: "https://blog-deblock-studios.vercel.app",
        category: "Communauté",
        base: 2320,
        slowAt: [52, 53, 54, 55, 56],
        downAt: [],
        uptime: { day: 99.2, week: 99.75, month: 99.81 },
      },
      {
        id: "wildium",
        name: "Wildium",
        description: "Site vitrine du serveur Wildium",
        url: "https://wildium.example.com",
        category: "Sites & outils",
        base: 260,
        slowAt: [],
        downAt: [57, 58, 59],
        uptime: { day: 96.67, week: 99.42, month: 99.6 },
        error: "Service injoignable (DNS, TLS ou connexion refusée)",
      },
      {
        id: "github",
        name: "GitHub — Deblock Studios",
        description: "Dépôts publics de l'organisation",
        url: "https://github.com/Deblock-Studios",
        category: "Infrastructure",
        base: 92,
        slowAt: [],
        downAt: [],
        uptime: { day: 100, week: 100, month: 100 },
      },
      {
        id: "auto-translate-ai",
        name: "Auto-Translate (AI)",
        description: "Traduction automatique par IA — fournisseurs principal et fallback",
        url: "https://vyceai.com/health",
        category: "Services IA",
        base: 240,
        slowAt: [],
        downAt: [],
        uptime: { day: 100, week: 99.98, month: 99.95 },
        providers: [
          {
            id: "vyce-primary",
            name: "Vyce AI",
            model: "deepseek-v4.1",
            role: "primary",
            status: "operational",
            avgMs: 13298,
            successRate: 100,
          },
        ],
      },
    ];

    const services = defs.map((def) => {
      const history = [];
      for (let index = 0; index < HEARTBEATS; index += 1) {
        const at = now - (HEARTBEATS - index) * 5 * 60000;
        const down = def.downAt.includes(index);
        const slow = def.slowAt.includes(index);
        const jitter = Math.round((random() - 0.5) * def.base * 0.18);
        history.push({
          at,
          ok: !down,
          latencyMs: down ? 3100 : Math.max(40, Math.round(def.base + jitter)),
        });
        if (slow) history[history.length - 1].latencyMs = 4200;
      }

      const last = history[history.length - 1];
      const status = !last.ok ? "down" : last.latencyMs >= SLOW_MS ? "degraded" : "operational";

      return {
        id: def.id,
        name: def.name,
        description: def.description,
        url: def.url,
        category: def.category,
        status,
        latencyMs: last.latencyMs,
        httpStatus: last.ok ? 200 : null,
        error: last.ok ? null : def.error || "Connexion impossible",
        checkedAt: new Date(last.at).toISOString(),
        uptime: def.uptime,
        history,
        providers: def.providers || null,
      };
    });

    const count = (status) => services.filter((item) => item.status === status).length;
    const measured = services.filter((item) => Number.isFinite(item.latencyMs));

    return {
      updatedAt: new Date(now - 42000).toISOString(),
      source: "demo",
      intervalMinutes: 5,
      summary: {
        status: count("down") > 0 ? "down" : count("degraded") > 0 ? "degraded" : "operational",
        total: services.length,
        operational: count("operational"),
        degraded: count("degraded"),
        down: count("down"),
        unknown: count("unknown"),
        avgLatencyMs: Math.round(
          measured.reduce((sum, item) => sum + item.latencyMs, 0) / measured.length,
        ),
        uptime: { day: 98.33, week: 99.5, month: 99.62 },
      },
      services,
    };
  }

  function mulberry32(seed) {
    let value = seed;
    return () => {
      value |= 0;
      value = (value + 0x6d2b79f5) | 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
})();
