// Lagring i D1 och sammanställningen som /stats lämnar ut.

export interface StoreEvent {
  uuid: string;
  source: "apple" | "google";
  signedAt: number;
  type: string;
  subtype: string | null;
  environment: string;
  bundleId: string;
  productId: string | null;
  subId: string | null;
  storefront: string | null;
  offer: string | null;
  price: number | null;
  currency: string | null;
}

export type SubStatus = "active" | "grace" | "retry" | "expired" | "revoked";

export interface SubscriptionState {
  subId: string;
  source: "apple" | "google";
  environment: string;
  bundleId: string;
  productId: string | null;
  status: SubStatus;
  autoRenew: boolean | null;
  offer: string | null;
  price: number | null;
  currency: string | null;
  storefront: string | null;
  expiresAt: number | null;
  updatedAt: number;
}

const stockholm = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });

/** Datum i svensk tid, ÅÅÅÅ-MM-DD. */
export function stockholmDate(at: number | Date): string {
  return stockholm.format(at);
}

/** Sparar händelsen. Falskt om den redan fanns (Apple skickar om vid fel). */
export async function insertEvent(db: D1Database, e: StoreEvent): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO events
         (uuid, source, signed_at, day, type, subtype, environment, bundle_id, product_id, sub_id, storefront, offer, price, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      e.uuid, e.source, e.signedAt, stockholmDate(e.signedAt), e.type, e.subtype, e.environment, e.bundleId,
      e.productId, e.subId, e.storefront, e.offer, e.price, e.currency,
    )
    .run();
  return res.meta.changes > 0;
}

/** Uppdaterar läget, men aldrig med en äldre händelse än den som redan står där. */
export async function upsertSubscription(db: D1Database, s: SubscriptionState): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscriptions
         (sub_id, source, environment, bundle_id, product_id, status, auto_renew, offer, price, currency, storefront, first_seen, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (sub_id) DO UPDATE SET
         product_id = COALESCE(excluded.product_id, subscriptions.product_id),
         status = excluded.status,
         auto_renew = COALESCE(excluded.auto_renew, subscriptions.auto_renew),
         offer = COALESCE(excluded.offer, subscriptions.offer),
         price = COALESCE(excluded.price, subscriptions.price),
         currency = COALESCE(excluded.currency, subscriptions.currency),
         storefront = COALESCE(excluded.storefront, subscriptions.storefront),
         expires_at = COALESCE(excluded.expires_at, subscriptions.expires_at),
         updated_at = excluded.updated_at
       WHERE excluded.updated_at >= subscriptions.updated_at`,
    )
    .bind(
      s.subId, s.source, s.environment, s.bundleId, s.productId, s.status,
      s.autoRenew === null ? null : Number(s.autoRenew), s.offer, s.price, s.currency, s.storefront,
      s.updatedAt, s.expiresAt, s.updatedAt,
    )
    .run();
}

export interface Stats {
  generatedAt: string;
  environment: string;
  active: {
    total: number;
    /** Aktiva där förnyelsen är avstängd, alltså uppsagda som löper ut. */
    notRenewing: number;
    bySource: Record<string, number>;
    byProduct: Record<string, number>;
    byOffer: Record<string, number>;
  };
  today: Record<string, number>;
  /** Händelser per dag i svensk tid, senaste dagen först. */
  days: { day: string; events: Record<string, number> }[];
  recent: {
    at: string;
    source: string;
    type: string;
    subtype: string | null;
    productId: string | null;
    offer: string | null;
    storefront: string | null;
  }[];
  lastEventAt: string | null;
}

const DAYS = 14;

export async function readStats(db: D1Database, environment: string, now = new Date()): Promise<Stats> {
  const today = stockholmDate(now);
  const since = stockholmDate(now.getTime() - (DAYS - 1) * 86_400_000);

  const [active, daily, recent] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT source, product_id, offer, COUNT(*) AS n, SUM(CASE WHEN auto_renew = 0 THEN 1 ELSE 0 END) AS off
           FROM subscriptions WHERE environment = ? AND status IN ('active', 'grace')
          GROUP BY source, product_id, offer`,
      )
      .bind(environment),
    db
      .prepare(
        `SELECT day, type, subtype, COUNT(*) AS n FROM events
          WHERE environment = ? AND day >= ? GROUP BY day, type, subtype ORDER BY day DESC`,
      )
      .bind(environment, since),
    db
      .prepare(
        `SELECT signed_at, source, type, subtype, product_id, offer, storefront FROM events
          WHERE environment = ? ORDER BY signed_at DESC LIMIT 25`,
      )
      .bind(environment),
  ]);

  const stats: Stats = {
    generatedAt: now.toISOString(),
    environment,
    active: { total: 0, notRenewing: 0, bySource: {}, byProduct: {}, byOffer: {} },
    today: {},
    days: [],
    recent: [],
    lastEventAt: null,
  };

  for (const row of active!.results) {
    const n = Number(row.n);
    const product = String(row.product_id ?? "okänd");
    const offer = String(row.offer ?? "okänd");
    stats.active.total += n;
    stats.active.notRenewing += Number(row.off ?? 0);
    stats.active.bySource[String(row.source)] = (stats.active.bySource[String(row.source)] ?? 0) + n;
    stats.active.byProduct[product] = (stats.active.byProduct[product] ?? 0) + n;
    stats.active.byOffer[offer] = (stats.active.byOffer[offer] ?? 0) + n;
  }

  for (const row of daily!.results) {
    const day = String(row.day);
    const key = row.subtype ? `${row.type}/${row.subtype}` : String(row.type);
    let entry = stats.days.at(-1);
    if (entry?.day !== day) stats.days.push((entry = { day, events: {} }));
    entry.events[key] = Number(row.n);
  }
  stats.today = stats.days.find((d) => d.day === today)?.events ?? {};

  stats.recent = recent!.results.map((row) => ({
    at: new Date(Number(row.signed_at)).toISOString(),
    source: String(row.source),
    type: String(row.type),
    subtype: (row.subtype as string | null) ?? null,
    productId: (row.product_id as string | null) ?? null,
    offer: (row.offer as string | null) ?? null,
    storefront: (row.storefront as string | null) ?? null,
  }));
  stats.lastEventAt = stats.recent[0]?.at ?? null;
  return stats;
}

export async function lastEventAt(db: D1Database): Promise<string | null> {
  const row = await db.prepare(`SELECT MAX(signed_at) AS at FROM events`).first<{ at: number | null }>();
  return row?.at ? new Date(row.at).toISOString() : null;
}
