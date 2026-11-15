// Minsta möjliga DER-läsare: precis det som behövs för att kontrollera
// Apples certifikatkedja med WebCrypto, utan beroenden.

export interface Node {
  tag: number;
  /** Hela elementet med tagg och längd. */
  raw: Uint8Array;
  /** Bara innehållet. */
  body: Uint8Array;
}

export function readNode(buf: Uint8Array, offset = 0): Node {
  if (offset + 2 > buf.length) throw new Error("DER: för kort");
  const tag = buf[offset]!;
  let len = buf[offset + 1]!;
  let head = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || offset + 2 + n > buf.length) throw new Error("DER: ogiltig längd");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i]!;
    head = 2 + n;
  }
  const end = offset + head + len;
  if (end > buf.length) throw new Error("DER: längden går utanför");
  return { tag, raw: buf.subarray(offset, end), body: buf.subarray(offset + head, end) };
}

export function children(node: Node): Node[] {
  const out: Node[] = [];
  let at = 0;
  while (at < node.body.length) {
    const child = readNode(node.body, at);
    out.push(child);
    at += child.raw.length;
  }
  return out;
}

export function oid(node: Node): string {
  if (node.tag !== 0x06 || node.body.length === 0) throw new Error("DER: inte en OID");
  const parts = [Math.floor(node.body[0]! / 40), node.body[0]! % 40];
  let value = 0;
  for (const byte of node.body.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

function time(node: Node): number {
  const s = new TextDecoder().decode(node.body);
  let m: RegExpMatchArray | null;
  if (node.tag === 0x17 && (m = s.match(/^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/))) {
    const yy = Number(m[1]);
    return Date.UTC(yy < 50 ? 2000 + yy : 1900 + yy, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  if (node.tag === 0x18 && (m = s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/))) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  throw new Error("DER: okänt tidsformat");
}

export interface Certificate {
  der: Uint8Array;
  tbs: Uint8Array;
  signatureOid: string;
  signature: Uint8Array;
  notBefore: number;
  notAfter: number;
  spki: Uint8Array;
  curveOid: string;
}

export function parseCertificate(der: Uint8Array): Certificate {
  const [tbs, sigAlg, sigValue] = children(readNode(der));
  if (!tbs || !sigAlg || !sigValue || sigValue.tag !== 0x03) throw new Error("Certifikat: oväntad form");

  const fields = children(tbs);
  // Version ([0]) finns i v3-certifikat och hoppas över.
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;
  const validity = fields[base + 3];
  const spki = fields[base + 5];
  if (!validity || !spki) throw new Error("Certifikat: fält saknas");

  const [notBefore, notAfter] = children(validity);
  const [keyAlg] = children(spki);
  const keyParams = keyAlg ? children(keyAlg) : [];
  if (!notBefore || !notAfter || keyParams.length < 2) throw new Error("Certifikat: fält saknas");
  if (oid(keyParams[0]!) !== "1.2.840.10045.2.1") throw new Error("Certifikat: inte en EC-nyckel");

  return {
    der,
    tbs: tbs.raw,
    signatureOid: oid(children(sigAlg)[0]!),
    // Första byten i en BIT STRING är antalet oanvända bitar.
    signature: sigValue.body.subarray(1),
    notBefore: time(notBefore),
    notAfter: time(notAfter),
    spki: spki.raw,
    curveOid: oid(keyParams[1]!),
  };
}

/** ECDSA-signatur i DER (SEQUENCE av r och s) till r||s med fast bredd, som WebCrypto vill ha. */
export function ecdsaDerToRaw(der: Uint8Array, size: number): Uint8Array {
  const parts = children(readNode(der));
  if (parts.length !== 2) throw new Error("Signatur: oväntad form");
  const out = new Uint8Array(size * 2);
  parts.forEach((part, i) => {
    let bytes = part.body;
    while (bytes.length > size && bytes[0] === 0) bytes = bytes.subarray(1);
    if (part.tag !== 0x02 || bytes.length > size) throw new Error("Signatur: oväntad form");
    out.set(bytes, size * (i + 1) - bytes.length);
  });
  return out;
}

/** Sant om certifikatet innehåller en OID, kodad som i ett tillägg. */
export function containsOid(der: Uint8Array, dotted: string): boolean {
  const parts = dotted.split(".").map(Number);
  const bytes = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let v = Math.floor(part / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  const needle = [0x06, bytes.length, ...bytes];
  outer: for (let i = 0; i + needle.length <= der.length; i++) {
    for (let j = 0; j < needle.length; j++) if (der[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
