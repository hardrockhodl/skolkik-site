// App Store Server Notifications V2: från Apples notis till en händelse och ett läge.
// Bara det som behövs för statistiken sparas. Inget kvitto, ingen token, inget om köparen.

import { verifyJws } from "./jws";
import type { StoreEvent, SubStatus, SubscriptionState } from "./store";

interface Notification {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  signedDate?: number;
  data?: {
    bundleId?: string;
    environment?: string;
    status?: number;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

interface Transaction {
  originalTransactionId?: string;
  productId?: string;
  storefront?: string;
  expiresDate?: number;
  offerType?: number;
  offerDiscountType?: string;
  price?: number;
  currency?: string;
}

interface RenewalInfo {
  autoRenewStatus?: number;
}

const STATUS: Record<number, SubStatus> = { 1: "active", 2: "expired", 3: "retry", 4: "grace", 5: "revoked" };

function statusOf(n: Notification): SubStatus {
  const known = n.data?.status ? STATUS[n.data.status] : undefined;
  if (known) return known;
  switch (n.notificationType) {
    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
      return "expired";
    case "REFUND":
    case "REVOKE":
      return "revoked";
    default:
      return "active";
  }
}

/** Vilket erbjudande perioden köptes med. */
export function offerOf(t: Transaction): string {
  switch (t.offerType) {
    case 1:
      return t.offerDiscountType === "FREE_TRIAL" ? "gratisperiod" : "intropris";
    case 2:
      return "kampanj";
    case 3:
      return "kod";
    case 4:
      return "winback";
    default:
      return "ordinarie";
  }
}

export interface Parsed {
  event: StoreEvent;
  /** Saknas för notiser som inte rör en prenumeration, till exempel TEST. */
  subscription: SubscriptionState | null;
}

export async function parseAppleNotification(signedPayload: string, rootSha256?: string, now = Date.now()): Promise<Parsed> {
  const n = await verifyJws<Notification>(signedPayload, rootSha256, now);
  const data = n.data ?? {};
  if (!n.notificationType || !n.notificationUUID || !data.bundleId) throw new Error("notisen saknar fält");

  const t = data.signedTransactionInfo ? await verifyJws<Transaction>(data.signedTransactionInfo, rootSha256, now) : null;
  const r = data.signedRenewalInfo ? await verifyJws<RenewalInfo>(data.signedRenewalInfo, rootSha256, now) : null;

  const signedAt = n.signedDate ?? now;
  const environment = data.environment ?? "Production";
  const offer = t ? offerOf(t) : null;

  const event: StoreEvent = {
    uuid: n.notificationUUID,
    source: "apple",
    signedAt,
    type: n.notificationType,
    subtype: n.subtype ?? null,
    environment,
    bundleId: data.bundleId,
    productId: t?.productId ?? null,
    subId: t?.originalTransactionId ?? null,
    storefront: t?.storefront ?? null,
    offer,
    price: t?.price ?? null,
    currency: t?.currency ?? null,
  };

  const subscription: SubscriptionState | null = t?.originalTransactionId
    ? {
        subId: t.originalTransactionId,
        source: "apple",
        environment,
        bundleId: data.bundleId,
        productId: t.productId ?? null,
        status: statusOf(n),
        autoRenew: r?.autoRenewStatus === undefined ? null : r.autoRenewStatus === 1,
        offer,
        price: t.price ?? null,
        currency: t.currency ?? null,
        storefront: t.storefront ?? null,
        expiresAt: t.expiresDate ?? null,
        updatedAt: signedAt,
      }
    : null;

  return { event, subscription };
}
