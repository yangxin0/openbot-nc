import type { ConnectorId as ReleasedConnectorId } from "@openbot/contracts/ipc";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { PASSWORD_MANAGERS_CAPABILITY } from "@openbot/contracts/team-protocol/password-managers-v1";
import { WHATSAPP_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";

export const CONNECTOR_IDS = [
  "whatsapp",
  "onepassword",
  "bitwarden",
  "protonpass",
] as const satisfies readonly ReleasedConnectorId[];

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export interface ConnectorDefinition {
  server: TeamCurrentCapability | null;
}

export const CONNECTORS: Readonly<Record<ConnectorId, ConnectorDefinition>> = {
  whatsapp: { server: WHATSAPP_CONNECTOR_CAPABILITY },
  onepassword: { server: ONEPASSWORD_CONNECTOR_CAPABILITY },
  bitwarden: { server: BITWARDEN_CONNECTOR_CAPABILITY },
  protonpass: { server: PASSWORD_MANAGERS_CAPABILITY },
};

const CONNECTOR_ID_SET = new Set<string>(CONNECTOR_IDS);

export function isConnectorId(value: string): value is ConnectorId {
  return CONNECTOR_ID_SET.has(value);
}
