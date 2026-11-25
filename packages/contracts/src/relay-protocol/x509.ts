export const RELAY_X509_OID = {
  ecPublicKey: "1.2.840.10045.2.1",
  prime256v1: "1.2.840.10045.3.1.7",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  basicConstraints: "2.5.29.19",
  extendedKeyUsage: "2.5.29.37",
  subjectAltName: "2.5.29.17",
} as const;

const NAME_FIELDS = new Map<string, string>([
  ["2.5.4.3", "CN"],
  ["2.5.4.10", "O"],
  ["2.5.4.11", "OU"],
]);

const TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  objectIdentifier: 0x06,
  utf8String: 0x0c,
  printableString: 0x13,
  teletexString: 0x14,
  ia5String: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18,
  bmpString: 0x1e,
  sequence: 0x30,
  set: 0x31,
  version: 0xa0,
  extensions: 0xa3,
  dnsName: 0x82,
  ipAddress: 0x87,
} as const;

export interface RelayX509Name {
  der: Uint8Array;
  attributes: ReadonlyArray<readonly [field: string, value: string]>;
}

export interface RelayX509Certificate {
  der: Uint8Array;
  tbs: Uint8Array;
  issuer: RelayX509Name;
  subject: RelayX509Name;
  notBefore: number;
  notAfter: number;
  authority: boolean;
  extendedKeyUsages: string[];
  dnsNames: string[];
  ipAddresses: string[];
  spki: Uint8Array;
  publicKeyAlgorithm: string;
  publicKeyCurve: string | null;
  signatureAlgorithm: string;
  signature: Uint8Array;
}

export interface RelayKeyAlgorithm {
  algorithm: string;
  curve: string | null;
}

interface DerElement {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
}

class DerReader {
  readonly #bytes: Uint8Array;
  #offset: number;
  readonly #end: number;

  constructor(bytes: Uint8Array, element?: DerElement) {
    this.#bytes = bytes;
    this.#offset = element ? element.contentStart : 0;
    this.#end = element ? element.end : bytes.byteLength;
  }

  get done(): boolean {
    return this.#offset >= this.#end;
  }

  peekTag(): number | null {
    return this.done ? null : (this.#bytes[this.#offset] ?? null);
  }

  next(expectedTag?: number): DerElement {
    const start = this.#offset;
    const tag = this.#byte(start);
    if ((tag & 0x1f) === 0x1f) throw new Error("The certificate uses a tag form that is not supported.");
    if (expectedTag !== undefined && tag !== expectedTag) throw new Error("The certificate has an unexpected field.");
    let length = this.#byte(start + 1);
    let contentStart = start + 2;
    if (length & 0x80) {
      const count = length & 0x7f;
      if (count === 0 || count > 4) throw new Error("The certificate has a length that is not supported.");
      length = 0;
      for (let index = 0; index < count; index += 1) length = length * 256 + this.#byte(start + 2 + index);
      contentStart += count;
    }
    const end = contentStart + length;
    if (end > this.#end) throw new Error("The certificate is truncated.");
    this.#offset = end;
    return { tag, start, contentStart, end };
  }

  #byte(index: number): number {
    const value = this.#bytes[index];
    if (index >= this.#end || value === undefined) throw new Error("The certificate is truncated.");
    return value;
  }
}

export function readRelayX509Certificate(der: Uint8Array): RelayX509Certificate | null {
  try {
    return readCertificate(der);
  } catch {
    return null;
  }
}

export function readRelayPrivateKeyAlgorithm(der: Uint8Array): RelayKeyAlgorithm | null {
  try {
    const outer = new DerReader(der);
    const info = new DerReader(der, outer.next(TAG.sequence));
    if (!outer.done) return null;
    info.next(TAG.integer);
    const key = algorithm(der, info.next(TAG.sequence));
    info.next(TAG.octetString);
    return { algorithm: key.oid, curve: key.parameter };
  } catch {
    return null;
  }
}

export function relayX509NamesEqual(first: RelayX509Name, second: RelayX509Name): boolean {
  if (first.der.byteLength !== second.der.byteLength) return false;
  return first.der.every((byte, index) => byte === second.der[index]);
}

export function relayEcdsaSignatureToP1363(der: Uint8Array, size = 32): Uint8Array | null {
  try {
    const outer = new DerReader(der);
    const sequence = outer.next(TAG.sequence);
    if (!outer.done) return null;
    const reader = new DerReader(der, sequence);
    const r = integerBytes(der, reader.next(TAG.integer), size);
    const s = integerBytes(der, reader.next(TAG.integer), size);
    if (!reader.done || !r || !s) return null;
    const signature = new Uint8Array(size * 2);
    signature.set(r, size - r.byteLength);
    signature.set(s, size * 2 - s.byteLength);
    return signature;
  } catch {
    return null;
  }
}

function readCertificate(der: Uint8Array): RelayX509Certificate {
  const outer = new DerReader(der);
  const certificate = outer.next(TAG.sequence);
  if (!outer.done) throw new Error("The certificate has trailing data.");
  const parts = new DerReader(der, certificate);
  const tbsElement = parts.next(TAG.sequence);
  const signatureAlgorithm = algorithm(der, parts.next(TAG.sequence)).oid;
  const signature = bitString(der, parts.next(TAG.bitString));
  if (!parts.done) throw new Error("The certificate has extra fields.");
  const tbs = new DerReader(der, tbsElement);
  if (tbs.peekTag() === TAG.version) tbs.next(TAG.version);
  tbs.next(TAG.integer);
  const innerAlgorithm = algorithm(der, tbs.next(TAG.sequence)).oid;
  if (innerAlgorithm !== signatureAlgorithm) throw new Error("The certificate names two signature algorithms.");
  const issuer = name(der, tbs.next(TAG.sequence));
  const validity = new DerReader(der, tbs.next(TAG.sequence));
  const notBefore = time(der, validity.next());
  const notAfter = time(der, validity.next());
  const subject = name(der, tbs.next(TAG.sequence));
  const spkiElement = tbs.next(TAG.sequence);
  const spki = new DerReader(der, spkiElement);
  const publicKey = algorithm(der, spki.next(TAG.sequence));
  spki.next(TAG.bitString);
  const extensions: Extensions = { authority: false, extendedKeyUsages: [], dnsNames: [], ipAddresses: [] };
  while (!tbs.done) {
    const element = tbs.next();
    if (element.tag === TAG.extensions) readExtensions(der, element, extensions);
  }
  return {
    der,
    tbs: der.slice(tbsElement.start, tbsElement.end),
    issuer,
    subject,
    notBefore,
    notAfter,
    ...extensions,
    spki: der.slice(spkiElement.start, spkiElement.end),
    publicKeyAlgorithm: publicKey.oid,
    publicKeyCurve: publicKey.parameter,
    signatureAlgorithm,
    signature,
  };
}

interface Extensions {
  authority: boolean;
  extendedKeyUsages: string[];
  dnsNames: string[];
  ipAddresses: string[];
}

function readExtensions(der: Uint8Array, element: DerElement, extensions: Extensions): void {
  const list = new DerReader(der, new DerReader(der, element).next(TAG.sequence));
  while (!list.done) {
    const extension = new DerReader(der, list.next(TAG.sequence));
    const oid = objectIdentifier(der, extension.next(TAG.objectIdentifier));
    if (extension.peekTag() === TAG.boolean) extension.next(TAG.boolean);
    const value = extension.next(TAG.octetString);
    if (oid === RELAY_X509_OID.basicConstraints) extensions.authority = basicConstraintsAuthority(der, value);
    else if (oid === RELAY_X509_OID.extendedKeyUsage) extensions.extendedKeyUsages = extendedKeyUsages(der, value);
    else if (oid === RELAY_X509_OID.subjectAltName) readSubjectAltNames(der, value, extensions);
  }
}

function basicConstraintsAuthority(der: Uint8Array, value: DerElement): boolean {
  const constraints = new DerReader(der, new DerReader(der, value).next(TAG.sequence));
  if (constraints.peekTag() !== TAG.boolean) return false;
  const flag = constraints.next(TAG.boolean);
  return flag.end - flag.contentStart === 1 && der[flag.contentStart] === 0xff;
}

function extendedKeyUsages(der: Uint8Array, value: DerElement): string[] {
  const list = new DerReader(der, new DerReader(der, value).next(TAG.sequence));
  const usages: string[] = [];
  while (!list.done) usages.push(objectIdentifier(der, list.next(TAG.objectIdentifier)));
  return usages;
}

function readSubjectAltNames(der: Uint8Array, value: DerElement, extensions: Extensions): void {
  const list = new DerReader(der, new DerReader(der, value).next(TAG.sequence));
  while (!list.done) {
    const entry = list.next();
    const content = der.subarray(entry.contentStart, entry.end);
    if (entry.tag === TAG.dnsName) extensions.dnsNames.push(asciiText(content));
    else if (entry.tag === TAG.ipAddress) {
      const address = ipAddressText(content);
      if (address !== null) extensions.ipAddresses.push(address);
    }
  }
}

function algorithm(der: Uint8Array, element: DerElement): { oid: string; parameter: string | null } {
  const reader = new DerReader(der, element);
  const oid = objectIdentifier(der, reader.next(TAG.objectIdentifier));
  const parameter = reader.peekTag() === TAG.objectIdentifier ? objectIdentifier(der, reader.next()) : null;
  return { oid, parameter };
}

function name(der: Uint8Array, element: DerElement): RelayX509Name {
  const attributes: Array<readonly [string, string]> = [];
  const sets = new DerReader(der, element);
  while (!sets.done) {
    const set = new DerReader(der, sets.next(TAG.set));
    while (!set.done) {
      const attribute = new DerReader(der, set.next(TAG.sequence));
      const oid = objectIdentifier(der, attribute.next(TAG.objectIdentifier));
      const value = attribute.next();
      attributes.push([NAME_FIELDS.get(oid) ?? oid, stringValue(der, value)]);
    }
  }
  return { der: der.slice(element.start, element.end), attributes };
}

function stringValue(der: Uint8Array, element: DerElement): string {
  const content = der.subarray(element.contentStart, element.end);
  if (
    element.tag === TAG.utf8String ||
    element.tag === TAG.printableString ||
    element.tag === TAG.ia5String ||
    element.tag === TAG.teletexString
  ) {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  }
  if (element.tag === TAG.bmpString) return new TextDecoder("utf-16be", { fatal: true }).decode(content);
  throw new Error("The certificate has a name of a type that is not supported.");
}

function time(der: Uint8Array, element: DerElement): number {
  const text = asciiText(der.subarray(element.contentStart, element.end));
  const match =
    element.tag === TAG.utcTime
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/u.exec(text)
      : element.tag === TAG.generalizedTime
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/u.exec(text)
        : null;
  if (!match) throw new Error("The certificate has a date that is not supported.");
  const [, yearText = "", month = "", day = "", hour = "", minute = "", second = ""] = match;
  const shortYear = Number(yearText);
  const year = element.tag === TAG.utcTime ? (shortYear >= 50 ? 1900 + shortYear : 2000 + shortYear) : shortYear;
  return Date.UTC(year, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function objectIdentifier(der: Uint8Array, element: DerElement): string {
  if (element.tag !== TAG.objectIdentifier || element.end === element.contentStart) {
    throw new Error("The certificate has an object identifier that is not valid.");
  }
  const parts: number[] = [];
  let value = 0;
  for (let index = element.contentStart; index < element.end; index += 1) {
    const byte = der[index] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER / 128) throw new Error("The certificate has an object identifier too large.");
    if (byte & 0x80) continue;
    if (parts.length === 0) parts.push(value < 80 ? Math.floor(value / 40) : 2, value < 80 ? value % 40 : value - 80);
    else parts.push(value);
    value = 0;
  }
  if ((der[element.end - 1] ?? 0) & 0x80) throw new Error("The certificate has an object identifier that ends early.");
  return parts.join(".");
}

function bitString(der: Uint8Array, element: DerElement): Uint8Array {
  if (der[element.contentStart] !== 0) throw new Error("The certificate has a bit string that is not supported.");
  return der.slice(element.contentStart + 1, element.end);
}

function integerBytes(der: Uint8Array, element: DerElement, size: number): Uint8Array | null {
  let start = element.contentStart;
  while (start < element.end - 1 && der[start] === 0) start += 1;
  const bytes = der.subarray(start, element.end);
  return bytes.byteLength > size || bytes.byteLength === 0 ? null : bytes;
}

function asciiText(bytes: Uint8Array): string {
  if (bytes.some((byte) => byte > 0x7e || byte < 0x20)) throw new Error("The certificate has text that is not ASCII.");
  return String.fromCharCode(...bytes);
}

function ipAddressText(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 4) return [...bytes].join(".");
  if (bytes.byteLength !== 16) return null;
  const words: string[] = [];
  for (let index = 0; index < 16; index += 2)
    words.push((((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0)).toString(16));
  return words.join(":");
}
