import type { MenuItem } from "./parse";
import { addDays, type StoredMenu } from "./store";

export interface IcsOptions {
  calName: string;
  source: string;
  /** Prefix i UID, t.ex. "matsedel-are". */
  uidPrefix: string;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

/** RFC 5545: rader längre än 75 oktetter bryts, utan att dela ett tecken. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // fortsättningsrader börjar med ett blanksteg
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** "Salladsbuffé: Salladsbuffé, bröd och dryck" blir bara texten. */
export function summaryOf(items: MenuItem[]): string {
  return items
    .map(({ kind, text }) =>
      !kind || kind === "Lunch" || text.toLowerCase().startsWith(kind.toLowerCase()) ? text : `${kind}: ${text}`,
    )
    .join(" · ");
}

function compact(date: string): string {
  return date.replaceAll("-", "");
}

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
}

export function buildIcs(menu: StoredMenu, opts: IcsOptions): string {
  const dtstamp = stamp(menu.updated);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SkolKik//Matsedel//SV",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calName)}`,
    "X-WR-TIMEZONE:Europe/Stockholm",
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D",
  ];

  for (const [date, items] of Object.entries(menu.days)) {
    const description = [...items.map((i) => (i.kind ? `${i.kind}: ${i.text}` : i.text)), "", `Källa: ${opts.source}`].join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${opts.uidPrefix}-${date}@skolkik.se`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      `SUMMARY:${escapeText(summaryOf(items))}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${opts.source}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
