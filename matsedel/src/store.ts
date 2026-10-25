import type { MenuDay, MenuItem } from "./parse";

export interface StoredMenu {
  /** När innehållet senast ändrades, ISO 8601. */
  updated: string;
  days: Record<string, MenuItem[]>;
}

export interface Meta {
  lastAttempt?: string;
  lastSuccess?: string;
  lastError?: string;
  lastErrorAt?: string;
  days?: number;
}

/** Hur länge passerade dagar sparas. Sidan själv visar bara två veckor. */
export const KEEP_DAYS = 56;

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Dagens datum i Sverige. */
export function stockholmDate(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(now);
}

/**
 * Dagarna på sidan ersätter de sparade (kommunen kan byta en rätt), äldre
 * dagar ligger kvar i KEEP_DAYS. `updated` flyttas bara när något ändrats,
 * så att ETag och kalenderns DTSTAMP står still mellan likadana hämtningar.
 */
export function mergeMenu(old: StoredMenu | null, fresh: MenuDay[], now: Date): StoredMenu {
  const cutoff = addDays(stockholmDate(now), -KEEP_DAYS);
  const days: Record<string, MenuItem[]> = {};

  for (const [date, items] of Object.entries(old?.days ?? {})) {
    if (date >= cutoff) days[date] = items;
  }
  for (const { date, items } of fresh) days[date] = items;

  const sorted = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
  const changed = !old || JSON.stringify(old.days) !== JSON.stringify(sorted);
  return { updated: changed ? now.toISOString() : old.updated, days: sorted };
}
