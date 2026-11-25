import type { CustomServerPlan } from "@openbot/contracts/custom-server-plans";
import type { HostKeyHandover } from "@openbot/contracts/host-key-handover";
import type { AvatarColor } from "@openbot/contracts/ipc";
import type { RemoteSessionTicket } from "@openbot/contracts/remote-control-plane";
import type { RemoteMemberRole, RemoteTicketClaims } from "@openbot/contracts/signal-protocol/ticket";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";

export type RemoteConnectionBootstrap = RemoteSessionTicket;

export type VerifiedRemoteSessionTicket = Pick<
  RemoteTicketClaims,
  "sessionId" | "hostId" | "userId" | "membershipId" | "authEpoch" | "sessionExpiresAt"
> & {
  role: RemoteMemberRole;
  clientPublicKey: string;
};

export interface RemoteHostSummary {
  hostId: string;
  name: string;
  logoKey: string | null;
  appearance?: ServerAppearance | null;
  devicePublicKey: string | null;
  keyHandovers: HostKeyHandover[];
  authEpoch: number;
  membershipId: string;
  role: "owner" | "admin" | "member";
  memberLimit?: number;
  hosted?: boolean;
  restartAvailable?: boolean;
  storageGb?: number;
  paymentRequired?: true;
  customPlan?: CustomServerPlan;
  hidden?: true;
}

export interface RemoteInviteRecord {
  inviteId: string;
  email: string | null;
  role: "admin" | "member";
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
  permanent: boolean;
  useCount: number;
}

export interface RemoteInvitePreview {
  inviteId: string;
  hostId: string;
  hostName: string;
  role: "admin" | "member";
  expiresAt: number;
  emailBound: boolean;
  permanent: boolean;
  devicePublicKey: string | null;
  keyHandovers: HostKeyHandover[];
}

export interface RemoteMemberRecord {
  membershipId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  chatColor?: AvatarColor | null;
  role: "owner" | "admin" | "member";
  status: "active" | "revoked";
  createdAt: number;
}
