export const RELAY_SERVER_AUTH_USAGE = "1.3.6.1.5.5.7.3.1";

export interface RelayServerCertificateFacts {
  issuedByRoot: boolean;
  authority: boolean;
  extendedKeyUsages: readonly string[];
  notBefore: number;
  notAfter: number;
  dnsNames: readonly string[];
  ipAddresses: readonly string[];
  p256Key: boolean;
}

export type RelayServerCertificateRefusal = "untrusted" | "authority" | "usage" | "not_in_date" | "host" | "key";

export type RelayServerProofRefusal = RelayServerCertificateRefusal | "unreadable" | "signature";

export interface RelaySubjectAltNames {
  dnsNames: string[];
  ipAddresses: string[];
}

type RelayHost = { kind: "dns"; name: string } | { kind: "ip"; address: string };

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

export function relayServerCertificateRefusal(
  facts: RelayServerCertificateFacts,
  check: { relayUrl: string | null; now: number },
): RelayServerCertificateRefusal | null {
  if (!facts.issuedByRoot) return "untrusted";
  if (facts.authority) return "authority";
  if (facts.extendedKeyUsages.length > 0 && !facts.extendedKeyUsages.includes(RELAY_SERVER_AUTH_USAGE)) {
    return "usage";
  }
  if (!Number.isFinite(facts.notBefore) || !Number.isFinite(facts.notAfter)) return "not_in_date";
  if (check.now < facts.notBefore || check.now >= facts.notAfter) return "not_in_date";
  if (!facts.p256Key) return "key";
  if (check.relayUrl !== null && !relayServerNamesHost(facts, check.relayUrl)) return "host";
  return null;
}

export function relayServerNamesHost(
  names: { dnsNames: readonly string[]; ipAddresses: readonly string[] },
  relayUrl: string,
): boolean {
  const host = relayHost(relayUrl);
  if (host === null) return false;
  if (host.kind === "dns") return names.dnsNames.some((name) => dnsName(name) === host.name);
  return names.ipAddresses.some((address) => canonicalIp(address) === host.address);
}

export function parseRelaySubjectAltName(text: string | undefined): RelaySubjectAltNames {
  const names: RelaySubjectAltNames = { dnsNames: [], ipAddresses: [] };
  for (const entry of (text ?? "").split(", ")) {
    if (entry.startsWith("DNS:")) names.dnsNames.push(entry.slice("DNS:".length));
    else if (entry.startsWith("IP Address:")) names.ipAddresses.push(entry.slice("IP Address:".length));
  }
  return names;
}

function relayHost(relayUrl: string): RelayHost | null {
  let hostname: string;
  try {
    hostname = new URL(relayUrl).hostname;
  } catch {
    return null;
  }
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const address = canonicalIp(hostname.slice(1, -1));
    return address === null ? null : { kind: "ip", address };
  }
  if (IPV4_PATTERN.test(hostname)) {
    const address = canonicalIp(hostname);
    return address === null ? null : { kind: "ip", address };
  }
  const name = dnsName(hostname);
  return name === "" ? null : { kind: "dns", name };
}

function dnsName(name: string): string {
  return name.toLowerCase().replace(/\.$/u, "");
}

function canonicalIp(address: string): string | null {
  const text = address.trim();
  if (text === "" || /[^0-9A-Fa-f.:]/u.test(text)) return null;
  try {
    const hostname = new URL(text.includes(":") ? `http://[${text}]/` : `http://${text}/`).hostname;
    if (text.includes(":")) return hostname.startsWith("[") ? hostname : null;
    return IPV4_PATTERN.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}
