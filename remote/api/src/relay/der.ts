const TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  objectIdentifier: 0x06,
  utf8String: 0x0c,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequence: 0x30,
  set: 0x31,
} as const;

const GENERALIZED_TIME_FIRST_YEAR = 2050;

export function derConcat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((bytes, part) => bytes + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derValue(tag: number, content: Uint8Array): Uint8Array {
  return derConcat([Uint8Array.of(tag), derLength(content.byteLength), content]);
}

export function derSequence(items: readonly Uint8Array[]): Uint8Array {
  return derValue(TAG.sequence, derConcat(items));
}

export function derSet(items: readonly Uint8Array[]): Uint8Array {
  return derValue(TAG.set, derConcat(items));
}

export function derBoolean(value: boolean): Uint8Array {
  return derValue(TAG.boolean, Uint8Array.of(value ? 0xff : 0x00));
}

export function derUnsignedInteger(magnitude: Uint8Array): Uint8Array {
  let start = 0;
  while (start < magnitude.byteLength - 1 && magnitude[start] === 0) start += 1;
  const trimmed = magnitude.subarray(start);
  const first = trimmed[0] ?? 0;
  const content =
    trimmed.byteLength === 0 ? Uint8Array.of(0) : first >= 0x80 ? derConcat([Uint8Array.of(0), trimmed]) : trimmed;
  return derValue(TAG.integer, content);
}

export function derSmallInteger(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error("The integer is out of range.");
  return derUnsignedInteger(value < 0x100 ? Uint8Array.of(value) : Uint8Array.of(value >> 8, value & 0xff));
}

export function derObjectIdentifier(dotted: string): Uint8Array {
  const arcs = dotted.split(".").map((arc) => Number(arc));
  const [first, second, ...rest] = arcs;
  if (first === undefined || second === undefined || arcs.some((arc) => !Number.isInteger(arc) || arc < 0)) {
    throw new Error("The object identifier is invalid.");
  }
  const bytes: number[] = [first * 40 + second];
  for (const arc of rest) {
    const groups: number[] = [arc % 128];
    for (let high = Math.floor(arc / 128); high > 0; high = Math.floor(high / 128)) groups.unshift((high % 128) | 0x80);
    bytes.push(...groups);
  }
  return derValue(TAG.objectIdentifier, Uint8Array.from(bytes));
}

export function derUtf8String(text: string): Uint8Array {
  return derValue(TAG.utf8String, new TextEncoder().encode(text));
}

export function derOctetString(content: Uint8Array): Uint8Array {
  return derValue(TAG.octetString, content);
}

export function derBitString(content: Uint8Array, unusedBits = 0): Uint8Array {
  return derValue(TAG.bitString, derConcat([Uint8Array.of(unusedBits), content]));
}

export function derTime(date: Date): Uint8Array {
  const pad = (value: number, width = 2) => value.toString().padStart(width, "0");
  const year = date.getUTCFullYear();
  const rest = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(
    date.getUTCMinutes(),
  )}${pad(date.getUTCSeconds())}Z`;
  const encoder = new TextEncoder();
  return year < GENERALIZED_TIME_FIRST_YEAR
    ? derValue(TAG.utcTime, encoder.encode(`${pad(year % 100)}${rest}`))
    : derValue(TAG.generalizedTime, encoder.encode(`${pad(year, 4)}${rest}`));
}

export function derExplicit(contextTag: number, content: Uint8Array): Uint8Array {
  return derValue(0xa0 | contextTag, content);
}

export function derImplicit(contextTag: number, content: Uint8Array): Uint8Array {
  return derValue(0x80 | contextTag, content);
}

interface DerElement {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
}

function readElement(bytes: Uint8Array, offset: number): DerElement {
  const tag = bytes[offset];
  const first = bytes[offset + 1];
  if (tag === undefined || first === undefined) throw new Error("The DER value is truncated.");
  let length = first;
  let contentStart = offset + 2;
  if (first >= 0x80) {
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new Error("The DER length is not supported.");
    length = 0;
    for (let index = 0; index < count; index += 1) {
      const next = bytes[contentStart + index];
      if (next === undefined) throw new Error("The DER value is truncated.");
      length = length * 256 + next;
    }
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > bytes.byteLength) throw new Error("The DER value is truncated.");
  return { tag, start: offset, contentStart, end };
}

function readChildren(bytes: Uint8Array, parent: DerElement): DerElement[] {
  const children: DerElement[] = [];
  for (let offset = parent.contentStart; offset < parent.end; ) {
    const child = readElement(bytes, offset);
    children.push(child);
    offset = child.end;
  }
  return children;
}

export function certificateSubjectDer(certificate: Uint8Array): Uint8Array {
  const outer = readElement(certificate, 0);
  const [toBeSigned] = readChildren(certificate, outer);
  if (outer.tag !== TAG.sequence || toBeSigned?.tag !== TAG.sequence) throw new Error("The certificate is invalid.");
  const fields = readChildren(certificate, toBeSigned);
  const versionOffset = fields[0]?.tag === 0xa0 ? 1 : 0;
  const subject = fields[versionOffset + 4];
  if (subject?.tag !== TAG.sequence) throw new Error("The certificate has no subject.");
  return certificate.slice(subject.start, subject.end);
}
