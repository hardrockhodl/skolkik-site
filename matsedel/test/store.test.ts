import { describe, expect, it } from "vitest";
import { mergeMenu, stockholmDate } from "../src/store";

const lunch = (text: string) => [{ kind: "Lunch", text }];

describe("mergeMenu", () => {
  const now = new Date("2026-10-25T04:00:00Z");

  it("ersätter dagar som finns på sidan och behåller äldre", () => {
    const old = { updated: "2026-10-24T04:00:00.000Z", days: { "2026-10-20": lunch("Gammal"), "2026-10-26": lunch("Före") } };
    const menu = mergeMenu(old, [{ date: "2026-10-26", items: lunch("Efter") }], now);
    expect(menu.days).toEqual({ "2026-10-20": lunch("Gammal"), "2026-10-26": lunch("Efter") });
    expect(menu.updated).toBe(now.toISOString());
  });

  it("rensar dagar äldre än åtta veckor", () => {
    const old = { updated: "x", days: { "2026-08-29": lunch("För gammal"), "2026-08-30": lunch("Precis") } };
    const menu = mergeMenu(old, [], now);
    expect(Object.keys(menu.days)).toEqual(["2026-08-30"]);
  });

  it("flyttar inte updated när inget ändrats", () => {
    const old = { updated: "2026-10-24T04:00:00.000Z", days: { "2026-10-26": lunch("Samma") } };
    expect(mergeMenu(old, [{ date: "2026-10-26", items: lunch("Samma") }], now).updated).toBe(old.updated);
  });

  it("sorterar datum", () => {
    const menu = mergeMenu(null, [{ date: "2026-10-27", items: lunch("b") }, { date: "2026-10-26", items: lunch("a") }], now);
    expect(Object.keys(menu.days)).toEqual(["2026-10-26", "2026-10-27"]);
  });
});

describe("stockholmDate", () => {
  it("räknar svensk tid, inte UTC", () => {
    expect(stockholmDate(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25"); // vintertid, 23:30
    expect(stockholmDate(new Date("2026-06-01T22:30:00Z"))).toBe("2026-06-02"); // sommartid, 00:30
  });
});
