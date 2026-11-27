import { canAdministerServer, isTeamMemberSummary, type TeamMemberSummary } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";

export type ServerMemberRole = "admin" | "member";

export interface ServerMemberChange {
  memberId: string;
  role?: ServerMemberRole;
  disabled?: boolean;
}

function invalidData(): Error {
  return new Error(sourceText("error.remote.invalidData"));
}

export function decodeServerMember(value: unknown): TeamMemberSummary {
  if (!isTeamMemberSummary(value)) throw invalidData();
  return value;
}

function decodeServerMembers(value: unknown): TeamMemberSummary[] {
  if (!Array.isArray(value)) throw invalidData();
  return value.map(decodeServerMember);
}

export function listServerMembers(request: TeamApiRequest): Promise<TeamMemberSummary[]> {
  return request("GET", TEAM_API_ROUTES.team.members, decodeServerMembers);
}

export function readCurrentMember(request: TeamApiRequest): Promise<TeamMemberSummary> {
  return request("GET", TEAM_API_ROUTES.me, decodeServerMember);
}

export function updateServerMember(request: TeamApiRequest, change: ServerMemberChange): Promise<TeamMemberSummary> {
  return request("PATCH", TEAM_API_ROUTES.team.member(change.memberId), decodeServerMember, {
    ...(change.role === undefined ? {} : { role: change.role }),
    ...(change.disabled === undefined ? {} : { disabled: change.disabled }),
  });
}

export function removeServerMember(request: TeamApiRequest, memberId: string): Promise<void> {
  return request("DELETE", TEAM_API_ROUTES.team.member(memberId), () => undefined);
}

export function canManageServerMember(
  viewer: Pick<TeamMemberSummary, "id" | "role"> | null,
  member: Pick<TeamMemberSummary, "id" | "role">,
): boolean {
  return viewer !== null && canAdministerServer(viewer.role) && member.role !== "owner" && member.id !== viewer.id;
}

export function sortServerMembers(members: readonly TeamMemberSummary[]): TeamMemberSummary[] {
  const rank = { owner: 0, admin: 1, member: 2 } as const;
  return [...members].sort(
    (left, right) =>
      rank[left.role] - rank[right.role] ||
      Number(left.disabled) - Number(right.disabled) ||
      serverMemberName(left).localeCompare(serverMemberName(right)),
  );
}

export function serverMemberName(member: Pick<TeamMemberSummary, "name" | "username">): string {
  return member.name || member.username;
}
