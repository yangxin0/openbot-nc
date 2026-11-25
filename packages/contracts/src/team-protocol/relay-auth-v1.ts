import { TEAM_API_ROUTES } from "../team-api-routes";
import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const TEAM_RELAY_AUTH_CAPABILITY = "relay-auth-v1";

const relayMember = fields({
  id: identifier,
  username: string(254),
  email: nullable(string(254)),
  name: nullable(string(120)),
  avatarUrl: nullable(string(2_048)),
  role: oneOf("owner", "admin", "member"),
  createdAt: string(64),
  disabled: boolean,
});

const relaySession = fields({ member: relayMember, sessionToken: string(512), sessionExpiresAt: string(64) });

export const RELAY_AUTH_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [TEAM_API_ROUTES.auth.relay, adminRoute(empty, relaySession)],
]);
