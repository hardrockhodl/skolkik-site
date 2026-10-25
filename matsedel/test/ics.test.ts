import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, summaryOf } from "../src/ics";

const opts = { calName: "Skolmat Åre kommun", source: "https://www.are.se/matsedel", uidPrefix: "matsedel-are" };

describe("buildIcs", () => {
  const ics = buildIcs(
    {
      updated: "2026-10-25T04:00:00.123Z",
      days: {
        "2026-10-30": [{ kind: "Lunch", text: "Fisk, potatis; sås" }],
        "2026-11-02": [{ kind: "Lunch", text: "Korvstroganoff med havreris" }],
      },
    },
    opts,
  );

  it("ger en heldagshändelse per dag med stabilt UID", () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:matsedel-are-2026-10-30@skolkik.se");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031");
    expect(ics).toContain("DTSTAMP:20261025T040000Z");
  });

  it("escapar text och använder CRLF", () => {
    expect(ics).toContain("SUMMARY:Fisk\\, potatis\\; sås");
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("håller alla rader inom 75 oktetter", () => {
    const enc = new TextEncoder();
    expect(ics.split("\r\n").every((l) => enc.encode(l).length <= 75)).toBe(true);
  });
});

describe("hjälpfunktioner", () => {
  it("bryter långa rader utan att dela tecken", () => {
    const folded = foldLine("SUMMARY:" + "å".repeat(60));
    const enc = new TextEncoder();
    expect(folded.split("\r\n").every((l) => enc.encode(l).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "å".repeat(60));
  });

  it("escapar backslash, semikolon, komma och radbrytning", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("utelämnar Lunch och upprepad sort i rubriken", () => {
    expect(summaryOf([{ kind: "Salladsbuffé", text: "Salladsbuffé, bröd och dryck" }])).toBe("Salladsbuffé, bröd och dryck");
    expect(
      summaryOf([
        { kind: "Lunch", text: "Pasta" },
        { kind: "Vegetariskt", text: "Linsgryta" },
      ]),
    ).toBe("Pasta · Vegetariskt: Linsgryta");
  });
});
