import type { ServerSummary } from "@openbot/contracts/ipc";
import type {
  EventActivity,
  EventRoutine,
  EventRoutineRef,
  EventRoutineRun,
  EventStatus,
  ListEventActivityInput,
  ListEventRoutineRunsInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
} from "@openbot/contracts/ipc-events";
import { runTeamEffect } from "@openbot/team-client";
import {
  deleteEventRoutine,
  getEventStatus,
  listEventActivity,
  listEventRoutineRuns,
  listEventRoutines,
  saveEventRoutine,
  testEventRoutine,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { remoteRoutineRecovery, serverCanAdminister } from "../servers/server-capabilities";
import type { ConversationRuntime } from "./conversation-runtime";

export interface RoutineWebhooksApi {
  getStatus: () => Promise<EventStatus>;
  listActivity: (input: ListEventActivityInput) => Promise<EventActivity[]>;
}

export interface EventRoutinesApi extends RoutineWebhooksApi {
  listRoutines: (input: ListEventRoutinesInput) => Promise<EventRoutine[]>;
  saveRoutine: (input: SaveEventRoutineInput) => Promise<SaveEventRoutineResult>;
  deleteRoutine: (input: EventRoutineRef) => Promise<void>;
  testRoutine: (input: EventRoutineRef) => Promise<void>;
  readonly listRuns?: ((input: ListEventRoutineRunsInput) => Promise<EventRoutineRun[]>) | undefined;
}

export function desktopChatEventRoutinesApi(
  server: ServerSummary | undefined,
  runtime: ConversationRuntime | undefined,
): EventRoutinesApi | undefined {
  return !runtime && serverCanAdminister(server, "events-v1")
    ? desktopEventRoutinesApi(server.id, remoteRoutineRecovery(server))
    : undefined;
}

export function desktopEventRoutinesApi(serverId: string, recovery = false): EventRoutinesApi {
  const events = window.openbot.events;
  return {
    ...(recovery ? { listRuns: (input: ListEventRoutineRunsInput) => events.listRoutineRuns(input, serverId) } : {}),
    getStatus: () => events.getStatus(serverId),
    listRoutines: (input) => events.listRoutines(input, serverId),
    saveRoutine: (input) => events.saveRoutine(input, serverId),
    deleteRoutine: (input) => events.deleteRoutine(input, serverId),
    testRoutine: (input) => events.testRoutine(input, serverId),
    listActivity: (input) => events.listActivity(input, serverId),
  };
}

export function webEventRoutinesApi(
  request: TeamApiRequest,
  recovery: () => boolean = () => false,
  runPlaces: () => boolean = () => false,
  once: () => boolean = () => false,
  pauseReasons: () => boolean = () => false,
): EventRoutinesApi {
  const run = <A>(effect: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  const listRuns = (input: ListEventRoutineRunsInput) => run(listEventRoutineRuns(request, input));
  return {
    get listRuns() {
      return recovery() ? listRuns : undefined;
    },
    getStatus: () => run(getEventStatus(request)),
    listRoutines: (input) => run(listEventRoutines(request, input, recovery(), runPlaces(), once(), pauseReasons())),
    saveRoutine: (input) => run(saveEventRoutine(request, input, recovery(), runPlaces(), once())),
    deleteRoutine: (input) => run(deleteEventRoutine(request, input)),
    testRoutine: (input) => run(testEventRoutine(request, input)),
    listActivity: (input) => run(listEventActivity(request, input)),
  };
}
