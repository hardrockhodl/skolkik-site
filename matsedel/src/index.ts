import { buildIcs } from "./ics";
import { checkDays, parseMenu } from "./parse";
import { mergeMenu, stockholmDate, type Meta, type StoredMenu } from "./store";

export interface Env {
  MENU: KVNamespace;
  SOURCE_URL: string;
  MUNICIPALITY: string;
  CAL_NAME: string;
}

const MENU_KEY = "menu";
const META_KEY = "meta";
const USER_AGENT = "SkolKik-matsedel/1.0 (+https://skolkik.se)";

async function readMeta(env: Env): Promise<Meta> {
  return (await env.MENU.get<Meta>(META_KEY, "json")) ?? {};
}

/** Hämtar sidan och sparar. Kastar vid fel, efter att felet skrivits i meta. */
export async function refresh(env: Env, now = new Date()): Promise<StoredMenu> {
  const meta = await readMeta(env);
  meta.lastAttempt = now.toISOString();

  try {
    const res = await fetch(env.SOURCE_URL, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`are.se svarade ${res.status}`);

    const days = parseMenu(await res.text());
    const problem = checkDays(days, stockholmDate(now));
    if (problem) throw new Error(problem);

    const old = await env.MENU.get<StoredMenu>(MENU_KEY, "json");
    const menu = mergeMenu(old, days, now);
    await env.MENU.put(MENU_KEY, JSON.stringify(menu));

    meta.lastSuccess = now.toISOString();
    meta.days = days.length;
    await env.MENU.put(META_KEY, JSON.stringify(meta));
    return menu;
  } catch (e) {
    meta.lastError = e instanceof Error ? e.message : String(e);
    meta.lastErrorAt = now.toISOString();
    await env.MENU.put(META_KEY, JSON.stringify(meta));
    throw e;
  }
}

async function loadMenu(env: Env): Promise<StoredMenu | null> {
  const menu = await env.MENU.get<StoredMenu>(MENU_KEY, "json");
  if (menu) return menu;
  // Första anropet efter driftsättning, innan cron hunnit köra.
  try {
    return await refresh(env);
  } catch {
    return null;
  }
}

const weekday = new Intl.DateTimeFormat("sv-SE", { weekday: "long", timeZone: "UTC" });

export function menuJson(menu: StoredMenu, env: Env, from: string) {
  return {
    municipality: env.MUNICIPALITY,
    source: env.SOURCE_URL,
    updated: menu.updated,
    days: Object.entries(menu.days)
      .filter(([date]) => date >= from)
      .map(([date, items]) => ({ date, weekday: weekday.format(new Date(`${date}T12:00:00Z`)), items })),
  };
}

async function etagOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex.slice(0, 16)}"`;
}

async function respond(req: Request, body: string, type: string, maxAge: number): Promise<Response> {
  const etag = await etagOf(body);
  const headers = {
    "content-type": type,
    "cache-control": `public, max-age=${maxAge}`,
    "access-control-allow-origin": "*",
    etag,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(req.method === "HEAD" ? null : body, { headers });
}

function unavailable(): Response {
  return new Response("Matsedeln är inte tillgänglig just nu\n", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "3600" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed\n", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(req.url);

    switch (url.pathname) {
      case "/matsedel.json": {
        const menu = await loadMenu(env);
        if (!menu) return unavailable();
        const fromParam = url.searchParams.get("from");
        const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : stockholmDate(new Date());
        return respond(req, JSON.stringify(menuJson(menu, env, from)), "application/json; charset=utf-8", 3600);
      }
      case "/matsedel.ics": {
        const menu = await loadMenu(env);
        if (!menu) return unavailable();
        const ics = buildIcs(menu, { calName: env.CAL_NAME, source: env.SOURCE_URL, uidPrefix: "matsedel-are" });
        return respond(req, ics, "text/calendar; charset=utf-8", 3600);
      }
      case "/health":
        return respond(req, JSON.stringify(await readMeta(env)), "application/json; charset=utf-8", 60);
      case "/":
        return new Response(
          `${env.CAL_NAME}\n\n/matsedel.json  matsedeln som JSON (?from=ÅÅÅÅ-MM-DD)\n/matsedel.ics   kalender att prenumerera på\n/health         senaste hämtningen\n\nKälla: ${env.SOURCE_URL}\n`,
          { headers: { "content-type": "text/plain; charset=utf-8" } },
        );
      default:
        return new Response("Not found\n", { status: 404 });
    }
  },

  // Väntar in hämtningen så att ett fel syns som misslyckad körning i Cloudflare.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await refresh(env);
  },
} satisfies ExportedHandler<Env>;
