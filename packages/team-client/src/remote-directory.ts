import type { CustomServerPlan } from "@openbot/contracts/custom-server-plans";
import type { ServerRelayHost } from "@openbot/contracts/ipc";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";

export interface RemoteTeamHost {
  hostId: string;
  name: string;
  logoKey: string | null;
  appearance?: ServerAppearance | null;
  devicePublicKey: string;
  membershipId: string;
  role: "owner" | "admin" | "member";
  memberLimit?: number;
  hosted?: boolean;
  hidden?: true;
  restartAvailable?: boolean;
  storageGb?: number;
  keyChangedAt?: number;
  paymentRequired?: true;
  customPlan?: CustomServerPlan;
  relayHost?: ServerRelayHost;
}
