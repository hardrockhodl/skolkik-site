import { describe, expect, it } from "vitest";
import { JwsError, verifyJws } from "../src/jws";
import { chain, sign } from "./helpers";

describe("verifyJws", () => {
  const payload = { notificationType: "TEST", n: 1 };

  it("godkänner en riktig kedja och lämnar ut innehållet", async () => {
    expect(await verifyJws(sign(payload), chain.rootSha256)).toEqual(payload);
  });

  it("avvisar ändrat innehåll", async () => {
    const [head, , sig] = sign(payload).split(".");
    const other = Buffer.from(JSON.stringify({ ...payload, n: 2 })).toString("base64url");
    await expect(verifyJws(`${head}.${other}.${sig}`, chain.rootSha256)).rejects.toThrow("signaturen stämmer inte");
  });

  it("avvisar en kedja som inte slutar i Apples rot", async () => {
    await expect(verifyJws(sign(payload))).rejects.toThrow("Apples rot");
  });

  it("avvisar ett certifikat utan Apples markering", async () => {
    const jws = sign(payload, chain.x5cUnmarked, chain.unmarkedKey);
    await expect(verifyJws(jws, chain.rootSha256)).rejects.toThrow("saknar Apples markering");
  });

  it("avvisar en signatur från fel nyckel", async () => {
    const jws = sign(payload, chain.x5c, chain.unmarkedKey);
    await expect(verifyJws(jws, chain.rootSha256)).rejects.toThrow("signaturen stämmer inte");
  });

  it("avvisar ett utbytt mellanled", async () => {
    const x5c = [chain.x5c[0]!, chain.x5c[2]!, chain.x5c[2]!];
    await expect(verifyJws(sign(payload, x5c), chain.rootSha256)).rejects.toBeInstanceOf(JwsError);
  });

  it("avvisar utgångna certifikat", async () => {
    const later = Date.UTC(2050, 0, 1);
    await expect(verifyJws(sign(payload), chain.rootSha256, later)).rejects.toThrow("giltighetstiden");
  });

  it("avvisar annan algoritm, saknad kedja och skräp", async () => {
    await expect(verifyJws(sign(payload, chain.x5c, chain.leafKey, "none"), chain.rootSha256)).rejects.toThrow("fel algoritm");
    await expect(verifyJws(sign(payload, []), chain.rootSha256)).rejects.toThrow("tre certifikat");
    await expect(verifyJws("inte.en.jws", chain.rootSha256)).rejects.toBeInstanceOf(JwsError);
    await expect(verifyJws("skräp", chain.rootSha256)).rejects.toBeInstanceOf(JwsError);
  });
});
