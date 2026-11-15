import { parseAppleNotification } from "./apple";
import { parseGoogleNotification } from "./google";
import { APPLE_ROOT_CA_G3_SHA256, JwsError } from "./jws";
import { insertEvent, lastEventAt, readStats, upsertSubscription } from "./store";

export interface Env {
  DB: D1Database;
  /** Appar vars händelser tas emot, kommaseparerat. */
  BUNDLE_IDS: string;
  /** Hemlighet för /stats. Utan den är /stats avstängd. */
  STATS_TOKEN?: string;
  /** Hemlighet i adressen som Pub/Sub skickar till. Utan den är /google avstängd. */
  GOOGLE_PUSH_TOKEN?: string;
}

const MAX_BODY = 100_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Jämför utan att tiden avslöjar var det skiljer sig. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const [p, q] = [new Uint8Array(x), new Uint8Array(y)];
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i]! ^ q[i]!;
  return diff === 0;
}

async function apple(request: Request, env: Env, rootSha256: string): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "för stor" }, 413);

  let signedPayload: unknown;
  try {
    signedPayload = (JSON.parse(text) as { signedPayload?: unknown }).signedPayload;
  } catch {
    return json({ error: "inte JSON" }, 400);
  }
  if (typeof signedPayload !== "string") return json({ error: "signedPayload saknas" }, 400);

  let parsed;
  try {
    parsed = await parseAppleNotification(signedPayload, rootSha256);
  } catch (e) {
    // Fel signatur eller trasig notis: inget sparas.
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, e instanceof JwsError ? 401 : 400);
  }

  const allowed = env.BUNDLE_IDS.split(",").map((s) => s.trim());
  if (!allowed.includes(parsed.event.bundleId)) return json({ error: "okänd app" }, 403);

  // Kastar D1 svarar workern 500 och Apple skickar notisen igen.
  const fresh = await insertEvent(env.DB, parsed.event);
  if (fresh && parsed.subscription) await upsertSubscription(env.DB, parsed.subscription);
  return json({ ok: true, duplicate: !fresh });
}

async function google(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.GOOGLE_PUSH_TOKEN) return json({ error: "GOOGLE_PUSH_TOKEN är inte satt" }, 503);
  if (!(await sameSecret(url.searchParams.get("token") ?? "", env.GOOGLE_PUSH_TOKEN))) {
    return json({ error: "fel eller ingen token" }, 401);
  }

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "för stor" }, 413);

  // Pub/Sub skickar om allt som inte får 2xx, i upp till en vecka. Det som aldrig
  // kan bli rätt kvitteras därför med 200 och sparas inte.
  let parsed;
  try {
    parsed = await parseGoogleNotification(JSON.parse(text));
  } catch (e) {
    return json({ ok: true, ignored: e instanceof Error ? e.message : String(e) });
  }
  const allowed = env.BUNDLE_IDS.split(",").map((s) => s.trim());
  if (!allowed.includes(parsed.event.bundleId)) return json({ ok: true, ignored: "okänd app" });

  const fresh = await insertEvent(env.DB, parsed.event);
  if (fresh && parsed.subscription) await upsertSubscription(env.DB, parsed.subscription);
  return json({ ok: true, duplicate: !fresh });
}

async function stats(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.STATS_TOKEN) return json({ error: "STATS_TOKEN är inte satt" }, 503);
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!(await sameSecret(given, env.STATS_TOKEN))) return json({ error: "fel eller ingen token" }, 401);

  const environment = url.searchParams.get("env") === "Sandbox" ? "Sandbox" : "Production";
  return json(await readStats(env.DB, environment));
}

export function makeWorker(rootSha256 = APPLE_ROOT_CA_G3_SHA256): ExportedHandler<Env> {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === "/apple" && request.method === "POST") return apple(request, env, rootSha256);
      if (url.pathname === "/google" && request.method === "POST") return google(request, env, url);
      if (url.pathname === "/stats" && request.method === "GET") return stats(request, env, url);
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, lastEventAt: await lastEventAt(env.DB) });
      }
      return json({ error: "finns inte" }, 404);
    },
  };
}

export default makeWorker();
