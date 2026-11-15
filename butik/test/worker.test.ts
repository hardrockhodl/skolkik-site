import { beforeEach, describe, expect, it } from "vitest";
import { makeWorker, type Env } from "../src/index";
import type { Stats } from "../src/store";
import { chain, fakeD1, notification, sign, type NotificationOptions } from "./helpers";

const worker = makeWorker(chain.rootSha256);
const T0 = Date.now() - 3_600_000;

let env: Env;
beforeEach(() => {
  env = { DB: fakeD1(), BUNDLE_IDS: "se.skolkik.app", STATS_TOKEN: "hemligt", GOOGLE_PUSH_TOKEN: "pubsub" };
});

function call(request: Request, e = env): Promise<Response> {
  return worker.fetch!(request as never, e, {} as ExecutionContext) as Promise<Response>;
}

function post(signedPayload: string): Promise<Response> {
  return call(new Request("https://butik.test/apple", { method: "POST", body: JSON.stringify({ signedPayload }) }));
}

const send = (o: NotificationOptions) => post(notification(o));

async function stats(query = ""): Promise<Stats> {
  const res = await call(new Request(`https://butik.test/stats${query}`, { headers: { authorization: "Bearer hemligt" } }));
  expect(res.status).toBe(200);
  return res.json();
}

const trial = { offerType: 1, offerDiscountType: "FREE_TRIAL", price: 0, currency: "SEK" };

describe("/apple", () => {
  it("räknar en ny prenumeration med gratisperiod", async () => {
    const res = await send({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, transaction: trial });
    expect(res.status).toBe(200);

    const s = await stats();
    expect(s.active).toEqual({
      total: 1,
      notRenewing: 0,
      bySource: { apple: 1 },
      byProduct: { "se.skolkik.app.plus.monthly": 1 },
      byOffer: { gratisperiod: 1 },
    });
    expect(s.today).toEqual({ "SUBSCRIBED/INITIAL_BUY": 1 });
    expect(s.recent[0]).toMatchObject({ source: "apple", type: "SUBSCRIBED", offer: "gratisperiod", storefront: "SWE" });
    expect(s.lastEventAt).toBe(new Date(T0).toISOString());
  });

  it("räknar inte samma notis två gånger", async () => {
    const o = { type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, transaction: trial };
    await send(o);
    const again = await send(o);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect((await stats()).today).toEqual({ "SUBSCRIBED/INITIAL_BUY": 1 });
  });

  it("följer en prenumeration från start över uppsägning till utgång", async () => {
    await send({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, transaction: trial });
    await send({
      type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED", uuid: "b", at: T0 + 1000, status: 1,
      transaction: trial, renewal: { autoRenewStatus: 0 },
    });
    expect((await stats()).active).toMatchObject({ total: 1, notRenewing: 1 });

    await send({ type: "EXPIRED", subtype: "VOLUNTARY", uuid: "c", at: T0 + 2000, status: 2, transaction: trial, renewal: { autoRenewStatus: 0 } });
    const s = await stats();
    expect(s.active.total).toBe(0);
    expect(s.today).toEqual({
      "SUBSCRIBED/INITIAL_BUY": 1,
      "DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_DISABLED": 1,
      "EXPIRED/VOLUNTARY": 1,
    });
  });

  it("låter inte en äldre notis skriva över ett nyare läge", async () => {
    await send({ type: "EXPIRED", subtype: "VOLUNTARY", uuid: "c", at: T0 + 2000, status: 2, transaction: trial });
    await send({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, transaction: trial });
    expect((await stats()).active.total).toBe(0);
  });

  it("skiljer på erbjudanden och produkter", async () => {
    await send({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, transaction: trial });
    await send({
      type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "b", at: T0, status: 1,
      transaction: { originalTransactionId: "2000", offerType: 3 },
    });
    await send({
      type: "DID_RENEW", uuid: "c", at: T0, status: 1,
      transaction: { originalTransactionId: "3000", productId: "se.skolkik.app.familj.yearly", price: 349000, currency: "SEK" },
    });
    const s = await stats();
    expect(s.active.byOffer).toEqual({ gratisperiod: 1, kod: 1, ordinarie: 1 });
    expect(s.active.byProduct).toEqual({ "se.skolkik.app.plus.monthly": 2, "se.skolkik.app.familj.yearly": 1 });
  });

  it("håller isär sandlåda och produktion", async () => {
    await send({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, environment: "Sandbox", transaction: trial });
    expect((await stats()).active.total).toBe(0);
    expect((await stats("?env=Sandbox")).active.total).toBe(1);
  });

  it("sparar Apples testnotis utan prenumeration", async () => {
    const res = await send({ type: "TEST", uuid: "t", at: T0, environment: "Sandbox", transaction: null });
    expect(res.status).toBe(200);
    const s = await stats("?env=Sandbox");
    expect(s.today).toEqual({ TEST: 1 });
    expect(s.active.total).toBe(0);
  });

  it("avvisar andra appar", async () => {
    const res = await send({ type: "SUBSCRIBED", uuid: "a", at: T0, status: 1, bundleId: "se.annan.app", transaction: trial });
    expect(res.status).toBe(403);
    expect((await stats()).recent).toEqual([]);
  });

  it("sparar ingenting när signaturen är fel", async () => {
    const good = notification({ type: "SUBSCRIBED", uuid: "a", at: T0, status: 1, transaction: trial });
    const [head, body] = good.split(".");
    const res = await post(`${head}.${body}.${"A".repeat(86)}`);
    expect(res.status).toBe(401);

    expect((await stats()).recent).toEqual([]);

    // Samma notis med rätt signatur går igenom.
    expect((await post(good)).status).toBe(200);
    expect((await stats()).recent).toHaveLength(1);
  });

  it("avvisar en inre del som inte är signerad av Apple", async () => {
    const good = notification({ type: "SUBSCRIBED", uuid: "a", at: T0, status: 1, transaction: trial });
    const outer = JSON.parse(Buffer.from(good.split(".")[1]!, "base64url").toString());
    outer.data.signedTransactionInfo = outer.data.signedTransactionInfo.replace(/\.[^.]+$/, `.${"A".repeat(86)}`);
    expect((await post(sign(outer))).status).toBe(401);
  });

  it("svarar 400 på skräp", async () => {
    const bad = (body: string) => call(new Request("https://butik.test/apple", { method: "POST", body }));
    expect((await bad("hej")).status).toBe(400);
    expect((await bad("{}")).status).toBe(400);
  });
});

describe("/google", () => {
  let id = 0;
  function push(notification: Record<string, unknown>, token = "pubsub", e = env): Promise<Response> {
    const data = Buffer.from(JSON.stringify({ version: "1.0", packageName: "se.skolkik.app", ...notification })).toString("base64");
    const body = JSON.stringify({ message: { data, messageId: String(++id) }, subscription: "projects/p/subscriptions/s" });
    return call(new Request(`https://butik.test/google?token=${token}`, { method: "POST", body }), e);
  }
  const sub = (notificationType: number, at: number, purchaseToken = "tok-1") => ({
    eventTimeMillis: String(at),
    subscriptionNotification: { version: "1.0", notificationType, purchaseToken, subscriptionId: "se.skolkik.app.plus.monthly" },
  });

  it("följer en prenumeration från köp över uppsägning till utgång", async () => {
    expect((await push(sub(4, T0))).status).toBe(200);
    let s = await stats();
    expect(s.active).toMatchObject({ total: 1, notRenewing: 0, bySource: { google: 1 }, byProduct: { "se.skolkik.app.plus.monthly": 1 } });
    expect(s.recent[0]).toMatchObject({ source: "google", type: "SUBSCRIPTION_PURCHASED" });

    await push(sub(3, T0 + 1000));
    expect((await stats()).active).toMatchObject({ total: 1, notRenewing: 1 });

    await push(sub(13, T0 + 2000));
    s = await stats();
    expect(s.active.total).toBe(0);
    expect(s.today).toEqual({ SUBSCRIPTION_PURCHASED: 1, SUBSCRIPTION_CANCELED: 1, SUBSCRIPTION_EXPIRED: 1 });
  });

  it("räknar ihop med Apple och sparar aldrig köpets token", async () => {
    await send({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, transaction: trial });
    await push(sub(4, T0, "hemlig-token"));
    expect((await stats()).active.bySource).toEqual({ apple: 1, google: 1 });

    const rows = await env.DB.prepare("SELECT sub_id FROM subscriptions WHERE source = 'google'").all<{ sub_id: string }>();
    expect(rows.results[0]!.sub_id).toMatch(/^g:[0-9a-f]{64}$/);
    expect(JSON.stringify(await stats())).not.toContain("hemlig-token");
  });

  it("räknar inte samma meddelande två gånger", async () => {
    const data = Buffer.from(JSON.stringify({ packageName: "se.skolkik.app", ...sub(4, T0) })).toString("base64");
    const body = JSON.stringify({ message: { data, messageId: "samma" } });
    const post = () => call(new Request("https://butik.test/google?token=pubsub", { method: "POST", body }));
    await post();
    expect(await (await post()).json()).toEqual({ ok: true, duplicate: true });
    expect((await stats()).today).toEqual({ SUBSCRIPTION_PURCHASED: 1 });
  });

  it("låter återbetalning dra tillbaka prenumerationen", async () => {
    await push(sub(4, T0));
    await push({ eventTimeMillis: String(T0 + 1000), voidedPurchaseNotification: { purchaseToken: "tok-1", productType: 1 } });
    expect((await stats()).active.total).toBe(0);
  });

  it("håller Play Consoles testnotis utanför produktionen", async () => {
    expect((await push({ eventTimeMillis: String(T0), testNotification: { version: "1.0" } })).status).toBe(200);
    expect((await stats()).today).toEqual({});
    expect((await stats("?env=Sandbox")).today).toEqual({ TEST: 1 });
  });

  it("kräver hemligheten i adressen", async () => {
    expect((await push(sub(4, T0), "fel")).status).toBe(401);
    expect((await push(sub(4, T0), "pubsub", { ...env, GOOGLE_PUSH_TOKEN: undefined })).status).toBe(503);
    expect((await stats()).recent).toEqual([]);
  });

  it("kvitterar det som aldrig kan bli rätt utan att spara", async () => {
    const other = await push({ packageName: "se.annan.app", ...sub(4, T0) });
    expect(await other.json()).toEqual({ ok: true, ignored: "okänd app" });
    const junk = await call(new Request("https://butik.test/google?token=pubsub", { method: "POST", body: "hej" }));
    expect(junk.status).toBe(200);
    expect((await stats()).recent).toEqual([]);
  });
});

describe("/stats och /health", () => {
  it("kräver rätt token", async () => {
    const get = (headers: Record<string, string>, e = env) => call(new Request("https://butik.test/stats", { headers }), e);
    expect((await get({})).status).toBe(401);
    expect((await get({ authorization: "Bearer fel" })).status).toBe(401);
    expect((await get({ authorization: "Bearer hemligt" }, { ...env, STATS_TOKEN: undefined })).status).toBe(503);
  });

  it("visar bara när senaste händelsen kom", async () => {
    await send({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", uuid: "a", at: T0, status: 1, transaction: trial });
    const res = await call(new Request("https://butik.test/health"));
    expect(await res.json()).toEqual({ ok: true, lastEventAt: new Date(T0).toISOString() });
  });

  it("svarar 404 på annat", async () => {
    expect((await call(new Request("https://butik.test/"))).status).toBe(404);
    expect((await call(new Request("https://butik.test/apple"))).status).toBe(404);
  });
});
