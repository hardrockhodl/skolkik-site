import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { refresh, type Env } from "../src/index";

const fixture = readFileSync(new URL("./fixtures/are-2026-10-25.html", import.meta.url), "utf8");

function makeEnv(): Env & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string, type?: string) {
      const v = store.get(key) ?? null;
      return v !== null && type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
  return {
    store,
    MENU: kv as unknown as KVNamespace,
    SOURCE_URL: "https://www.are.se/matsedel",
    MUNICIPALITY: "Åre kommun",
    CAL_NAME: "Skolmat Åre kommun",
  };
}

function mockFetch(body: string, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body, { status }));
}

afterEach(() => vi.restoreAllMocks());

describe("refresh", () => {
  const now = new Date("2026-10-25T04:00:00Z");

  it("sparar matsedeln och noterar lyckad hämtning", async () => {
    const env = makeEnv();
    mockFetch(fixture);
    const menu = await refresh(env, now);
    expect(Object.keys(menu.days)).toHaveLength(10);
    expect(JSON.parse(env.store.get("meta")!)).toMatchObject({ lastSuccess: now.toISOString(), days: 10 });
  });

  it("behåller gammal matsedel när sidan inte går att tolka", async () => {
    const env = makeEnv();
    mockFetch(fixture);
    await refresh(env, now);
    const before = env.store.get("menu");

    mockFetch("<html>Ny design</html>");
    await expect(refresh(env, now)).rejects.toThrow(/Inga dagar/);
    expect(env.store.get("menu")).toBe(before);
    expect(JSON.parse(env.store.get("meta")!).lastError).toMatch(/Inga dagar/);
  });

  it("kastar vid HTTP-fel", async () => {
    const env = makeEnv();
    mockFetch("nej", 502);
    await expect(refresh(env, now)).rejects.toThrow("are.se svarade 502");
  });
});

describe("fetch", () => {
  // Fixturen gäller bara kring 25 oktober, och fetch använder klockan.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  async function get(env: Env, path: string, headers: Record<string, string> = {}) {
    return worker.fetch(new Request(`https://matsedel-are.example.workers.dev${path}`, { headers }), env);
  }

  it("serverar JSON från ett angivet datum", async () => {
    const env = makeEnv();
    mockFetch(fixture);
    const res = await get(env, "/matsedel.json?from=2026-11-04");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: { date: string; weekday: string }[] };
    expect(body.days.map((d) => d.date)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(body.days[0].weekday).toBe("onsdag");
  });

  it("serverar ICS och svarar 304 på samma ETag", async () => {
    const env = makeEnv();
    mockFetch(fixture);
    const res = await get(env, "/matsedel.ics");
    expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
    expect(await res.text()).toContain("SUMMARY:Korvstroganoff med havreris");

    const again = await get(env, "/matsedel.ics", { "if-none-match": res.headers.get("etag")! });
    expect(again.status).toBe(304);
  });

  it("svarar 503 när det inte finns någon matsedel", async () => {
    const env = makeEnv();
    mockFetch("", 500);
    expect((await get(env, "/matsedel.json")).status).toBe(503);
  });

  it("svarar 404 på okända sökvägar", async () => {
    expect((await get(makeEnv(), "/annat")).status).toBe(404);
  });
});
