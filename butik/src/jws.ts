import { containsOid, ecdsaDerToRaw, parseCertificate, type Certificate } from "./der";

/** SHA-256 av "Apple Root CA - G3", samma som på apple.com/certificateauthority. */
export const APPLE_ROOT_CA_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";

// Apples markeringar i kedjan för App Store-kvitton.
const OID_INTERMEDIATE = "1.2.840.113635.100.6.2.1";
const OID_LEAF = "1.2.840.113635.100.6.11.1";

const CURVES: Record<string, { name: string; size: number }> = {
  "1.2.840.10045.3.1.7": { name: "P-256", size: 32 },
  "1.3.132.0.34": { name: "P-384", size: 48 },
};
const HASHES: Record<string, string> = {
  "1.2.840.10045.4.3.2": "SHA-256",
  "1.2.840.10045.4.3.3": "SHA-384",
};

export class JwsError extends Error {}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fromBase64Url(s: string): Uint8Array {
  return fromBase64(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function importKey(cert: Certificate): Promise<{ key: CryptoKey; size: number }> {
  const curve = CURVES[cert.curveOid];
  if (!curve) throw new JwsError("okänd kurva i certifikatet");
  const key = await crypto.subtle.importKey("spki", cert.spki, { name: "ECDSA", namedCurve: curve.name }, false, ["verify"]);
  return { key, size: curve.size };
}

async function signedBy(cert: Certificate, issuer: Certificate): Promise<boolean> {
  const hash = HASHES[cert.signatureOid];
  if (!hash) throw new JwsError("okänd signaturalgoritm i certifikatet");
  const { key, size } = await importKey(issuer);
  return crypto.subtle.verify({ name: "ECDSA", hash }, key, ecdsaDerToRaw(cert.signature, size), cert.tbs);
}

/**
 * Kontrollerar en JWS från App Store och lämnar ut innehållet.
 * Kedjan i x5c ska sluta i Apples rot, och varje led ska vara signerat av nästa.
 */
export async function verifyJws<T>(jws: string, rootSha256 = APPLE_ROOT_CA_G3_SHA256, now = Date.now()): Promise<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new JwsError("inte en JWS");
  const [head, body, sig] = parts as [string, string, string];

  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(head))) as { alg?: string; x5c?: string[] };
    if (header.alg !== "ES256") throw new JwsError("fel algoritm");
    if (!Array.isArray(header.x5c) || header.x5c.length !== 3) throw new JwsError("kedjan ska ha tre certifikat");

    const [leaf, intermediate, root] = header.x5c.map((c) => parseCertificate(fromBase64(c))) as [Certificate, Certificate, Certificate];

    if ((await sha256Hex(root.der)) !== rootSha256) throw new JwsError("kedjan slutar inte i Apples rot");
    for (const cert of [leaf, intermediate, root]) {
      if (now < cert.notBefore || now > cert.notAfter) throw new JwsError("certifikat utanför giltighetstiden");
    }
    if (!containsOid(intermediate.der, OID_INTERMEDIATE)) throw new JwsError("mellancertifikatet saknar Apples markering");
    if (!containsOid(leaf.der, OID_LEAF)) throw new JwsError("certifikatet saknar Apples markering");
    if (!(await signedBy(intermediate, root)) || !(await signedBy(leaf, intermediate))) {
      throw new JwsError("kedjan håller inte");
    }

    const { key, size } = await importKey(leaf);
    const signature = fromBase64Url(sig);
    if (signature.length !== size * 2) throw new JwsError("fel längd på signaturen");
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!ok) throw new JwsError("signaturen stämmer inte");

    return JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T;
  } catch (e) {
    if (e instanceof JwsError) throw e;
    throw new JwsError(e instanceof Error ? e.message : String(e));
  }
}
