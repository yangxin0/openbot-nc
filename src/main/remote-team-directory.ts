import type { TeamMemberSummary, UpdateTeamMemberInput } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import { decodeVoid } from "./remote-host-decoding";
import type { RemoteRequestFn } from "./remote-server-client";
import { RemoteRequest, type RemoteWorkflowError } from "./remote-service-effects";
import { decodeTeamMember, decodeTeamMembers } from "./remote-team-decoding";

export interface RemoteTeamDirectoryOptions {
  request: RemoteRequestFn;
}

export class RemoteTeamDirectory {
  readonly #request: RemoteRequestFn;

  constructor(options: RemoteTeamDirectoryOptions) {
    this.#request = options.request;
  }

  readonly listMembers = Effect.fn("RemoteTeam.listMembers")(
    function* (
      this: RemoteTeamDirectory,
      serverId: string,
    ): Effect.fn.Return<TeamMemberSummary[], RemoteWorkflowError, RemoteRequest> {
      return yield* RemoteRequest.use((service) =>
        service.request(serverId, TEAM_API_ROUTES.team.members, decodeTeamMembers),
      );
    },
    (operation) => operation.pipe(Effect.provide(RemoteRequest.layer(this.#request))),
  ).bind(this);

  readonly updateMember = Effect.fn("RemoteTeam.updateMember")(
    function* (
      this: RemoteTeamDirectory,
      serverId: string,
      input: UpdateTeamMemberInput,
    ): Effect.fn.Return<TeamMemberSummary, RemoteWorkflowError, RemoteRequest> {
      return yield* RemoteRequest.use((service) =>
        service.request(serverId, TEAM_API_ROUTES.team.member(input.memberId), decodeTeamMember, {
          method: "PATCH",
          body: { role: input.role, disabled: input.disabled },
        }),
      );
    },
    (operation) => operation.pipe(Effect.provide(RemoteRequest.layer(this.#request))),
  ).bind(this);

  readonly removeMember = Effect.fn("RemoteTeam.removeMember")(
    function* (this: RemoteTeamDirectory, serverId: string, memberId: string) {
      return yield* RemoteRequest.use((service) =>
        service.request(serverId, TEAM_API_ROUTES.team.member(memberId), decodeVoid, { method: "DELETE" }),
      );
    },
    (operation) => operation.pipe(Effect.provide(RemoteRequest.layer(this.#request))),
  ).bind(this);
}
