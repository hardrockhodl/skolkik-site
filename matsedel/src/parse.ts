// Läser matsedeln ur are.se:s Sitevision-sida. Varje dag är ett
// <li class="sv-channel-item"> med datumet i .sv-font-fet och rätterna i
// .normal. Båda flikarna ("Denna veckan", "Nästa vecka") finns i samma HTML.

export interface MenuItem {
  /** "Lunch", "Salladsbuffé" och så vidare. Tom om raden saknar kolon. */
  kind: string;
  text: string;
}

export interface MenuDay {
  /** ÅÅÅÅ-MM-DD */
  date: string;
  items: MenuItem[];
}

const ITEM_RE = /<li\s+class="sv-channel-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
const DATE_RE = /<span\s+class="sv-font-fet"[^>]*>([\s\S]*?)<\/span>/;
const DISH_RE = /<span\s+class="normal"[^>]*>([\s\S]*?)<\/span>/g;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function splitItem(line: string): MenuItem {
  const m = /^([^:]{1,40}):\s*(.+)$/.exec(line);
  return m ? { kind: m[1].trim(), text: m[2].trim() } : { kind: "", text: line };
}

/** Dagar i datumordning. Samma datum två gånger slås ihop. */
export function parseMenu(html: string): MenuDay[] {
  const byDate = new Map<string, MenuItem[]>();

  for (const [, body] of html.matchAll(ITEM_RE)) {
    const heading = DATE_RE.exec(body);
    const date = heading && /(\d{4}-\d{2}-\d{2})/.exec(cleanText(heading[1]))?.[1];
    if (!date) continue;

    const items = byDate.get(date) ?? [];
    for (const [, dish] of body.matchAll(DISH_RE)) {
      const line = cleanText(dish);
      if (line && !items.some((i) => `${i.kind}: ${i.text}` === line || i.text === line)) {
        items.push(splitItem(line));
      }
    }
    byDate.set(date, items);
  }

  return [...byDate.entries()]
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items }));
}

/**
 * Nil om dagarna ser rimliga ut, annars varför inte. Hellre ingen uppdatering
 * än att skriva över en fungerande matsedel med skräp när sidan ändras.
 */
export function checkDays(days: MenuDay[], today: string): string | null {
  if (days.length === 0) return "Inga dagar hittades på sidan";

  const base = Date.parse(`${today}T00:00:00Z`);
  for (const { date } of days) {
    const t = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) {
      return `Ogiltigt datum: ${date}`;
    }
    const diff = (t - base) / 86_400_000;
    if (diff < -14 || diff > 42) return `Datum långt från idag: ${date}`;
  }
  return null;
}
