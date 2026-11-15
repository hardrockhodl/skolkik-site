// Google Play Real-time developer notifications, levererade av Pub/Sub som push.
// Notisen säger bara vad som hände och med vilket köp. Köpets token sparas aldrig,
// bara dess SHA-256 som id för prenumerationen.

import type { StoreEvent, SubStatus, SubscriptionState } from "./store";

interface PubSubPush {
  message?: { data?: string; messageId?: string; message_id?: string };
}

interface DeveloperNotification {
  packageName?: string;
  eventTimeMillis?: string | number;
  subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string };
  voidedPurchaseNotification?: { purchaseToken?: string; productType?: number };
  oneTimeProductNotification?: { notificationType?: number; sku?: string };
  testNotification?: unknown;
}

// Googles nummer för prenumerationshändelser.
const TYPES: Record<number, string> = {
  1: "RECOVERED",
  2: "RENEWED",
  3: "CANCELED",
  4: "PURCHASED",
  5: "ON_HOLD",
  6: "IN_GRACE_PERIOD",
  7: "RESTARTED",
  8: "PRICE_CHANGE_CONFIRMED",
  9: "DEFERRED",
  10: "PAUSED",
  11: "PAUSE_SCHEDULE_CHANGED",
  12: "REVOKED",
  13: "EXPIRED",
  20: "PENDING_PURCHASE_CANCELED",
};

/** Läget efter händelsen. Saknas typen här ändrar händelsen inte läget. */
const STATES: Record<string, { status: SubStatus; autoRenew: boolean | null }> = {
  PURCHASED: { status: "active", autoRenew: true },
  RENEWED: { status: "active", autoRenew: true },
  RECOVERED: { status: "active", autoRenew: true },
  RESTARTED: { status: "active", autoRenew: true },
  // Uppsagd men löper perioden ut.
  CANCELED: { status: "active", autoRenew: false },
  IN_GRACE_PERIOD: { status: "grace", autoRenew: null },
  ON_HOLD: { status: "retry", autoRenew: null },
  PAUSED: { status: "expired", autoRenew: null },
  EXPIRED: { status: "expired", autoRenew: null },
  REVOKED: { status: "revoked", autoRenew: null },
};

async function tokenId(purchaseToken: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(purchaseToken)));
  return "g:" + [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ParsedGoogle {
  event: StoreEvent;
  subscription: SubscriptionState | null;
}

export async function parseGoogleNotification(body: unknown, now = Date.now()): Promise<ParsedGoogle> {
  const message = (body as PubSubPush | null)?.message;
  const messageId = message?.messageId ?? message?.message_id;
  if (!message?.data || !messageId) throw new Error("inte ett Pub/Sub-meddelande");

  const bytes = Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0));
  const n = JSON.parse(new TextDecoder().decode(bytes)) as DeveloperNotification;
  if (!n.packageName) throw new Error("notisen saknar paketnamn");

  const signedAt = Number(n.eventTimeMillis) || now;
  const event: StoreEvent = {
    uuid: `google:${messageId}`,
    source: "google",
    signedAt,
    type: "UNKNOWN",
    subtype: null,
    environment: "Production",
    bundleId: n.packageName,
    productId: null,
    subId: null,
    storefront: null,
    offer: null,
    price: null,
    currency: null,
  };
  let state: { status: SubStatus; autoRenew: boolean | null } | undefined;

  if (n.testNotification) {
    // Testknappen i Play Console. Hålls utanför produktionssiffrorna, som Apples TEST.
    event.type = "TEST";
    event.environment = "Sandbox";
  } else if (n.subscriptionNotification?.purchaseToken) {
    const s = n.subscriptionNotification;
    const name = TYPES[s.notificationType ?? 0] ?? `TYPE_${s.notificationType}`;
    event.type = `SUBSCRIPTION_${name}`;
    event.productId = s.subscriptionId ?? null;
    event.subId = await tokenId(s.purchaseToken!);
    state = STATES[name];
  } else if (n.voidedPurchaseNotification?.purchaseToken) {
    const v = n.voidedPurchaseNotification;
    event.type = "VOIDED_PURCHASE";
    event.subId = await tokenId(v.purchaseToken!);
    if (v.productType === 1) state = { status: "revoked", autoRenew: null };
  } else if (n.oneTimeProductNotification) {
    event.type = "ONE_TIME_PRODUCT";
    event.productId = n.oneTimeProductNotification.sku ?? null;
  }

  const subscription: SubscriptionState | null =
    state && event.subId
      ? {
          subId: event.subId,
          source: "google",
          environment: event.environment,
          bundleId: event.bundleId,
          productId: event.productId,
          status: state.status,
          autoRenew: state.autoRenew,
          offer: null,
          price: null,
          currency: null,
          storefront: null,
          expiresAt: null,
          updatedAt: signedAt,
        }
      : null;

  return { event, subscription };
}
