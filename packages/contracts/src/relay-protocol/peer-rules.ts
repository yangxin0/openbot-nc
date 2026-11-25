import { RELAY_SUBJECT_FIELDS, RELAY_SUBJECT_NAME_PATTERN, type RelayPeer } from "./messages";

export interface RelaySubjectNames {
  team: string | null;
  user: string;
  device: string | null;
}

export interface RelayValidity {
  notBefore: number;
  notAfter: number;
}

export interface RelayValidityWindow {
  startsAt: number;
  expiresAt: number;
}

export type RelayPeerRefusal = "unreadable" | "key_mismatch" | "name_mismatch" | "untrusted" | "not_in_date";

export interface RelayCertificateView<Certificate> {
  authority: (certificate: Certificate) => boolean;
  keyId: (certificate: Certificate) => string;
  names: (certificate: Certificate) => RelaySubjectNames | null;
  validity: (certificate: Certificate) => RelayValidity;
  issuedBy: (certificate: Certificate, authority: Certificate) => boolean;
}

export interface RelayPeerCheck<Certificate> {
  peer: RelayPeer;
  leaf: Certificate | null;
  root: Certificate | null;
  chain: readonly Certificate[];
  team: string;
  now: number;
  view: RelayCertificateView<Certificate>;
}

export function relaySubjectNames(
  attributes: Iterable<readonly [field: string, value: string]>,
): RelaySubjectNames | null {
  const values = new Map<string, string[]>();
  for (const [field, value] of attributes) values.set(field, [...(values.get(field) ?? []), value]);
  const single = (field: string): string | null | undefined => {
    const list = values.get(field) ?? [];
    const [value] = list;
    if (list.length === 0) return null;
    return list.length === 1 && value !== undefined && RELAY_SUBJECT_NAME_PATTERN.test(value) ? value : undefined;
  };
  const team = single(RELAY_SUBJECT_FIELDS.team);
  const user = single(RELAY_SUBJECT_FIELDS.user);
  const device = single(RELAY_SUBJECT_FIELDS.device);
  if (team === undefined || device === undefined || user === undefined || user === null) return null;
  return { team, user, device };
}

export function relayValidityWindow(periods: readonly RelayValidity[]): RelayValidityWindow | null {
  const startsAt = Math.max(...periods.map((period) => period.notBefore));
  const expiresAt = Math.min(...periods.map((period) => period.notAfter));
  return Number.isFinite(startsAt) && Number.isFinite(expiresAt) ? { startsAt, expiresAt } : null;
}

export function relayTrustPath<Certificate>(
  leaf: Certificate,
  root: Certificate,
  chain: readonly Certificate[],
  issuedBy: (certificate: Certificate, authority: Certificate) => boolean,
): Certificate[] | null {
  if (issuedBy(leaf, root)) return [root];
  for (const authority of chain) {
    if (issuedBy(leaf, authority) && issuedBy(authority, root)) return [authority, root];
  }
  return null;
}

export function relayPeerRefusal<Certificate>(check: RelayPeerCheck<Certificate>): RelayPeerRefusal | null {
  const { peer, leaf, root, view } = check;
  if (!leaf || !root || view.authority(leaf)) return "unreadable";
  if (view.keyId(leaf) !== peer.keyId) return "key_mismatch";
  const names = view.names(leaf);
  if (!names || names.team !== check.team || names.user !== peer.user || names.device !== peer.device) {
    return "name_mismatch";
  }
  const authorities = relayTrustPath(leaf, root, check.chain, view.issuedBy);
  if (!authorities) return "untrusted";
  const window = relayValidityWindow([leaf, ...authorities].map(view.validity));
  if (!window || check.now < window.startsAt || check.now >= window.expiresAt) return "not_in_date";
  return null;
}
