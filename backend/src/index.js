// ═══════════════════════════════════════════════════════════
// Deblock Status API — Cloudflare Worker
// Pings every service from services.json, stores uptime in KV,
// exposes GET /api/status as JSON.
// ═══════════════════════════════════════════════════════════

import services from "../services.json";

const SNAPSHOT_KEY = "status:snapshot:v1";
const RECENT_LIMIT = 60; // ~5 h of checks at 5 min intervals
const DAYS_LIMIT = 90; // rolling uptime buckets
const CONCURRENCY = 6; // parallel probes per run
// Keep in sync with "triggers.crons" in wrangler.jsonc.
const CHECK_INTERVAL_MINUTES = 5;
const USER_AGENT =
  "DeblockStatus/1.0 (+https://github.com/Deblock-Studios/DeblockStatus)";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405, cors);
    }

    if (url.pathname === "/" || url.pathname === "/api") {
      return json(
        {
          name: "Deblock Status API",
          version: 1,
          endpoints: ["/api/status", "/api/health"],
          source: "https://github.com/Deblock-Studios/DeblockStatus",
        },
        200,
        cors,
      );
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, time: new Date().toISOString() }, 200, cors);
    }

    if (url.pathname === "/api/status") {
      const { snapshot, source } = await getSnapshot(env);
      return json(present(snapshot, source), 200, cors);
    }

    return json({ error: "not_found" }, 404, cors);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runChecks(env, true));
  },
};

// ── Configuration ──────────────────────────────────────────

function monitoredServices() {
  const seen = new Set();
  const result = [];

  for (const raw of Array.isArray(services) ? services : []) {
    if (!raw || typeof raw.url !== "string") {
      console.warn("services.json: entrée ignorée (url manquante)", raw);
      continue;
    }
    let parsed;
    try {
      parsed = new URL(raw.url);
    } catch {
      console.warn(`services.json: URL invalide pour "${raw.name}"`, raw.url);
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      console.warn(`services.json: protocole non supporté pour "${raw.name}"`);
      continue;
    }
    const id =
      slug(raw.id || raw.name || parsed.hostname) || slug(parsed.hostname);
    if (seen.has(id)) {
      console.warn(`services.json: identifiant en double, entrée ignorée "${id}"`);
      continue;
    }
    seen.add(id);
    result.push({ ...raw, id });
  }

  return result;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ── Checks ─────────────────────────────────────────────────

async function checkService(service) {
  const startedAt = Date.now();
  const timeoutMs = clamp(Number(service.timeoutMs) || 10000, 1000, 25000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(service.url, {
      method: String(service.method || "GET").toUpperCase(),
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "*/*",
        "cache-control": "no-cache",
      },
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const statusOk = expectedStatusOk(service.expectedStatus, response.status);

    let bodyOk = true;
    if (typeof service.expectBody === "string" && service.expectBody.length) {
      const text = await response.text();
      bodyOk = text.includes(service.expectBody);
    } else if (response.body) {
      // Drain nothing: the status code is enough.
      response.body.cancel().catch(() => {});
    }

    const ok = statusOk && bodyOk;
    return {
      at: Date.now(),
      ok,
      latencyMs,
      httpStatus: response.status,
      error: ok
        ? null
        : statusOk
          ? `Contenu attendu introuvable (${service.expectBody})`
          : `HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const aborted = error && (error.name === "AbortError" || controller.signal.aborted);
    const message = String((error && error.message) || error || "");
    // Cloudflare masque les erreurs réseau bas niveau (DNS, TLS, connexion refusée).
    const opaque = /internal error|network connection lost|fetch failed|unable to connect/i.test(
      message,
    );
    return {
      at: Date.now(),
      ok: false,
      latencyMs,
      httpStatus: null,
      error: aborted
        ? `Délai dépassé (${timeoutMs} ms)`
        : opaque
          ? "Service injoignable (DNS, TLS ou connexion refusée)"
          : message || "Erreur réseau",
    };
  } finally {
    clearTimeout(timer);
  }
}

function expectedStatusOk(expected, actual) {
  if (expected == null) return actual >= 200 && actual < 400;
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.some((value) => Number(value) === actual);
}

async function runChecks(env, write) {
  const list = monitoredServices();
  const previous = await readSnapshot(env);
  const results = await mapLimit(list, CONCURRENCY, checkService);
  const checkedAt = Date.now();
  const today = isoDay(checkedAt);

  const next = { version: 1, checkedAt, services: {} };

  list.forEach((service, index) => {
    const result = results[index];
    const before = (previous && previous.services && previous.services[service.id]) || null;

    const recent = Array.isArray(before && before.recent) ? before.recent.slice(-RECENT_LIMIT + 1) : [];
    recent.push({ at: result.at, ok: result.ok, latencyMs: result.latencyMs });

    const days = { ...((before && before.days) || {}) };
    const bucket = days[today] || { ok: 0, total: 0 };
    days[today] = {
      ok: bucket.ok + (result.ok ? 1 : 0),
      total: bucket.total + 1,
    };
    pruneDays(days, checkedAt);

    next.services[service.id] = {
      last: result,
      recent,
      days,
    };
  });

  if (write && env.STATUS_KV) {
    try {
      await env.STATUS_KV.put(SNAPSHOT_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("STATUS_KV: écriture impossible", error);
    }
  }

  return next;
}

// ── Storage ────────────────────────────────────────────────

async function readSnapshot(env) {
  if (!env.STATUS_KV) return null;
  try {
    const raw = await env.STATUS_KV.get(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("STATUS_KV: lecture impossible", error);
    return null;
  }
}

async function getSnapshot(env) {
  const stored = await readSnapshot(env);
  if (stored && stored.services && Object.keys(stored.services).length) {
    return { snapshot: stored, source: "kv" };
  }
  // No cron run yet (fresh deploy or KV not connected): probe live once.
  return { snapshot: await runChecks(env, false), source: "live" };
}

// ── Presentation ───────────────────────────────────────────

function present(snapshot, source) {
  const list = monitoredServices();
  const now = Date.now();

  const services = list.map((service) => {
    const entry = (snapshot.services && snapshot.services[service.id]) || {};
    const last = entry.last || null;
    const recent = Array.isArray(entry.recent) ? entry.recent : [];
    const days = entry.days || {};
    const degradedMs = clamp(Number(service.degradedMs) || 2500, 200, 60000);

    let status = "unknown";
    if (last) {
      if (!last.ok) status = "down";
      else if (last.latencyMs >= degradedMs) status = "degraded";
      else status = "operational";
    }

    return {
      id: service.id,
      name: service.name || service.id,
      description: service.description || null,
      url: service.url,
      category: service.category || "Services",
      status,
      latencyMs: last ? last.latencyMs : null,
      httpStatus: last ? last.httpStatus ?? null : null,
      error: last ? last.error ?? null : null,
      checkedAt: last ? new Date(last.at).toISOString() : null,
      uptime: {
        day: uptime(days, 1, now),
        week: uptime(days, 7, now),
        month: uptime(days, 30, now),
      },
      history: recent.slice(-RECENT_LIMIT).map((check) => ({
        at: check.at,
        ok: Boolean(check.ok),
        latencyMs: check.latencyMs,
      })),
    };
  });

  const count = (status) => services.filter((s) => s.status === status).length;
  const down = count("down");
  const degraded = count("degraded");
  const unknown = count("unknown");
  const operational = count("operational");

  const latencies = services
    .filter((s) => s.status !== "down" && typeof s.latencyMs === "number")
    .map((s) => s.latencyMs);

  return {
    updatedAt: new Date(snapshot.checkedAt || now).toISOString(),
    source,
    intervalMinutes: CHECK_INTERVAL_MINUTES,
    summary: {
      status:
        down > 0
          ? "down"
          : degraded > 0
            ? "degraded"
            : operational > 0
              ? "operational"
              : "unknown",
      total: services.length,
      operational,
      degraded,
      down,
      unknown,
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
        : null,
      uptime: {
        day: globalUptime(snapshot, list, 1, now),
        week: globalUptime(snapshot, list, 7, now),
        month: globalUptime(snapshot, list, 30, now),
      },
    },
    services,
  };
}

function uptime(days, dayCount, now) {
  let total = 0;
  let ok = 0;
  for (let index = 0; index < dayCount; index += 1) {
    const bucket = days[isoDay(now - index * 86400000)];
    if (bucket) {
      total += bucket.total;
      ok += bucket.ok;
    }
  }
  return total ? round2((ok / total) * 100) : null;
}

function globalUptime(snapshot, list, dayCount, now) {
  let total = 0;
  let ok = 0;
  for (const service of list) {
    const entry = (snapshot.services && snapshot.services[service.id]) || {};
    for (let index = 0; index < dayCount; index += 1) {
      const bucket = (entry.days || {})[isoDay(now - index * 86400000)];
      if (bucket) {
        total += bucket.total;
        ok += bucket.ok;
      }
    }
  }
  return total ? round2((ok / total) * 100) : null;
}

// ── Helpers ────────────────────────────────────────────────

function pruneDays(days, now) {
  const cutoff = isoDay(now - (DAYS_LIMIT - 1) * 86400000);
  for (const key of Object.keys(days)) {
    if (key < cutoff) delete days[key];
  }
}

function isoDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function json(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=60",
      ...extraHeaders,
    },
  });
}

// Accepte "https://site.com", "https://site.com/" et "https://site.com/*".
// Une valeur avec un chemin (ex. "https://site.com/*") est refusée par les
// navigateurs : on la normalise pour éviter un CORS cassé côté client.
function normalizeOrigin(value) {
  return String(value)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/\*$/, "")
    .toLowerCase();
}

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  const origin = request.headers.get("origin") || "";
  const allowAll = allowed.includes("*");
  const allowedOrigin = allowAll
    ? "*"
    : allowed.includes(normalizeOrigin(origin))
      ? origin
      : null;

  const headers = {
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  // Origine non autorisée : on n'envoie pas d'en-tête CORS, le navigateur
  // bloque la lecture (comportement attendu) au lieu de recevoir une valeur
  // invalide qui casserait aussi les origines légitimes.
  if (allowedOrigin) headers["access-control-allow-origin"] = allowedOrigin;
  return headers;
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
