import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDays, decodeEntities, parseMenu, splitItem } from "../src/parse";

const fixture = readFileSync(new URL("./fixtures/are-2026-10-25.html", import.meta.url), "utf8");

describe("parseMenu", () => {
  const days = parseMenu(fixture);

  it("hittar båda veckorna", () => {
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
  });

  it("delar upp sort och rätt och avkodar entiteter", () => {
    expect(days[0].items).toEqual([{ kind: "Salladsbuffé", text: "Salladsbuffé, bröd och dryck" }]);
    expect(days[5].items).toEqual([{ kind: "Lunch", text: "Korvstroganoff med havreris" }]);
    expect(days[6].items[0].text).toBe("Fisk med frasigt täcke serveras med kokt potatis och kall örtsås");
  });

  it("slår ihop samma datum och flera rätter", () => {
    const html = `
      <li class="sv-channel-item c1"><span class="sv-font-fet">Måndag 2026-11-09</span>
        <span class="normal">Lunch: Pasta</span></li>
      <li class="sv-channel-item c1"><span class="sv-font-fet">M&#229;ndag 2026-11-09</span>
        <span class="normal">Lunch: Pasta</span><span class="normal">Vegetariskt: Linsgryta</span></li>`;
    expect(parseMenu(html)).toEqual([
      {
        date: "2026-11-09",
        items: [
          { kind: "Lunch", text: "Pasta" },
          { kind: "Vegetariskt", text: "Linsgryta" },
        ],
      },
    ]);
  });

  it("ger inga dagar för en sida utan matsedel", () => {
    expect(parseMenu("<html><body>Sidan finns inte</body></html>")).toEqual([]);
  });
});

describe("hjälpfunktioner", () => {
  it("avkodar hexadecimala, decimala och namngivna entiteter", () => {
    expect(decodeEntities("Salladsbuff&#xE9; &#229; &amp; &nbsp;x &okänd;")).toBe("Salladsbuffé å &  x &okänd;");
  });

  it("lämnar rader utan kolon hela", () => {
    expect(splitItem("Kockarnas val")).toEqual({ kind: "", text: "Kockarnas val" });
  });
});

describe("checkDays", () => {
  const day = (date: string) => ({ date, items: [{ kind: "Lunch", text: "x" }] });

  it("godkänner sidan som den ser ut", () => {
    expect(checkDays(parseMenu(fixture), "2026-10-25")).toBeNull();
  });

  it("stoppar tomma, ogiltiga och avlägsna datum", () => {
    expect(checkDays([], "2026-10-25")).toMatch(/Inga dagar/);
    expect(checkDays([day("2026-02-30")], "2026-02-20")).toMatch(/Ogiltigt/);
    expect(checkDays([day("2025-10-26")], "2026-10-25")).toMatch(/långt/);
  });
});
