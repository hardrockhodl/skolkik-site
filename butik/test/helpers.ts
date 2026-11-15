import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const chain = JSON.parse(readFileSync(new URL("./fixtures/testkedja.json", import.meta.url), "utf8")) as {
  rootSha256: string;
  x5c: string[];
  leafKey: string;
  x5cUnmarked: string[];
  unmarkedKey: string;
};

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** Signerar som App Store gör: ES256 med kedjan i x5c. */
export function sign(payload: unknown, x5c = chain.x5c, key = chain.leafKey, alg = "ES256"): string {
  const input = `${b64url(JSON.stringify({ alg, x5c }))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign("SHA256").update(input).sign({ key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

export interface NotificationOptions {
  type: string;
  subtype?: string;
  uuid: string;
  at: number;
  status?: number;
  environment?: string;
  bundleId?: string;
  transaction?: Record<string, unknown> | null;
  renewal?: Record<string, unknown> | null;
}

export function notification(o: NotificationOptions): string {
  const transaction =
    o.transaction === null
      ? undefined
      : sign({ originalTransactionId: "1000", productId: "se.skolkik.app.plus.monthly", storefront: "SWE", ...o.transaction });
  const renewal = o.renewal === null || o.transaction === null ? undefined : sign({ autoRenewStatus: 1, ...o.renewal });
  return sign({
    notificationType: o.type,
    subtype: o.subtype,
    notificationUUID: o.uuid,
    signedDate: o.at,
    data: {
      bundleId: o.bundleId ?? "se.skolkik.app",
      environment: o.environment ?? "Production",
      status: o.status,
      signedTransactionInfo: transaction,
      signedRenewalInfo: renewal,
    },
  });
}

/** D1 ovanpå node:sqlite, så att testerna kör den riktiga SQL:en och migreringen. */
export function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));

  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    async run() {
      const res = db.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(res.changes) } };
    },
    async all() {
      return { success: true, results: db.prepare(sql).all(...(params as never[])) };
    },
    async first() {
      return db.prepare(sql).get(...(params as never[])) ?? null;
    },
  });

  return {
    prepare: (sql: string) => statement(sql),
    batch: (statements: { all(): Promise<unknown> }[]) => Promise.all(statements.map((s) => s.all())),
  } as unknown as D1Database;
}
