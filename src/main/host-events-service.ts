import type {
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRef,
  ListEventActivityInput,
  ListEventRoutineRunsInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
} from "@openbot/contracts/ipc-events";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect, Semaphore } from "effect";
import { RoutineOperationFailed } from "../backend/agent/routine-scheduler";
import { removeWebhookSecretKey, type WebhookRoutineWriter } from "../backend/agent/webhook-routine-tool";
import type { AgentApiKeys } from "../backend/agent-api-keys";
import { causeHelpers } from "../backend/effect-boundary";
import type { RoutineRecords } from "../backend/routine-records";
import type { OwnedRoutineRecord } from "../backend/routine-store";
import { type HostEventsApi, HostEventsFailure, hostEventsFailureMessage } from "./host-events-api";

const DEFAULT_ACTIVITY_LIMIT = 50;
const DEFAULT_RUN_LIMIT = 10;

export interface HostAgentWebhookKeys {
  has(agentId: string, name: string): Effect.Effect<boolean, { readonly cause: unknown }>;
  remove(agentId: string, name: string): Effect.Effect<void, { readonly cause: unknown }>;
}

export function hostAgentWebhookKeys(keys: AgentApiKeys): HostAgentWebhookKeys {
  return {
    has: (agentId, name) => keys.has(agentId, name),
    remove: (agentId, name) => keys.remove(agentId, name).pipe(Effect.asVoid),
  };
}

export interface HostEventsServiceOptions {
  routines: RoutineRecords;
  agentKeys?: HostAgentWebhookKeys;
}

const { sync: eventStep, rewrap: toHostEventsFailure } = causeHelpers(HostEventsFailure);

function eventFailure(message: string): HostEventsFailure {
  return new HostEventsFailure({ cause: new Error(message) });
}

function eventRoutine(owner: EventRoutineOwner, record: OwnedRoutineRecord): EventRoutine {
  const { ownerId: _ownerId, trigger, ...fields } = record;
  return {
    ...fields,
    owner,
    trigger:
      trigger.kind === "schedule"
        ? { kind: "schedule", schedule: trigger.schedule }
        : { kind: "webhook", url: trigger.url, eventType: trigger.eventType, filters: trigger.filters },
  };
}

export class HostEventsService implements HostEventsApi {
  readonly #options: HostEventsServiceOptions;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(options: HostEventsServiceOptions) {
    this.#options = options;
  }

  getStatus() {
    return Effect.succeed({ supported: true, connected: false });
  }

  readonly listRoutines = Effect.fn("HostEvents.listRoutines")(function* (
    this: HostEventsService,
    input: ListEventRoutinesInput,
  ) {
    yield* this.#requireOwner(input.owner);
    return yield* eventStep(() =>
      this.#options.routines.list(input.owner).map((record) => eventRoutine(input.owner, record)),
    );
  }).bind(this);

  readonly saveRoutine = Effect.fn("HostEvents.saveRoutine")(function* (
    this: HostEventsService,
    input: SaveEventRoutineInput,
  ) {
    const saved = yield* this.#saveRecord(input);
    const current = yield* eventStep(() => this.#options.routines.get(input.owner, saved.id) ?? saved);
    return { routine: eventRoutine(input.owner, current), secret: null };
  }).bind(this);

  readonly deleteRoutine = Effect.fn("HostEvents.deleteRoutine")(
    function* (this: HostEventsService, input: EventRoutineRef) {
      yield* toHostEventsFailure(this.#options.routines.delete(input.owner, input.id));
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly testRoutine = Effect.fn("HostEvents.testRoutine")(function* (
    this: HostEventsService,
    input: EventRoutineRef,
  ) {
    yield* toHostEventsFailure(this.#options.routines.test(input.owner, input.id));
  }).bind(this);

  readonly listActivity = Effect.fn("HostEvents.listActivity")(function* (
    this: HostEventsService,
    input: ListEventActivityInput,
  ) {
    yield* this.#requireRoutine({ owner: input.owner, id: input.routineId });
    const limit = input.limit ?? DEFAULT_ACTIVITY_LIMIT;
    return yield* eventStep(() => this.#options.routines.routes.listReceipts(input.owner.kind, input.routineId, limit));
  }).bind(this);

  readonly listRoutineRuns = Effect.fn("HostEvents.listRoutineRuns")(function* (
    this: HostEventsService,
    input: ListEventRoutineRunsInput,
  ) {
    yield* this.#requireRoutine({ owner: input.owner, id: input.routineId });
    return yield* eventStep(() =>
      this.#options.routines.listRuns(input.owner, input.routineId, input.limit ?? DEFAULT_RUN_LIMIT),
    );
  }).bind(this);

  readonly #saveRecord = Effect.fn("HostEvents.saveRecord")(
    function* (this: HostEventsService, input: SaveEventRoutineInput) {
      const { owner, trigger } = input;
      if (trigger.kind !== "schedule") return yield* eventFailure(sourceText("error.backend.webhooksRemoved"));
      yield* this.#requireOwner(owner);
      const existing = input.id ? yield* this.#requireRoutine({ owner, id: input.id }) : null;
      const saved = yield* eventStep(() =>
        this.#options.routines.save(owner, input.id, {
          name: input.name,
          instruction: input.instruction,
          active: input.active,
          timezone: input.timezone,
          trigger: { kind: "schedule", schedule: trigger.schedule },
          ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
          ...(input.missedPolicy === undefined ? {} : { missedPolicy: input.missedPolicy }),
          ...(input.runIn === undefined ? {} : { runIn: input.runIn }),
        }),
      );
      if (existing?.trigger.kind === "webhook") yield* this.#dropAgentKey({ owner, id: existing.id });
      return saved;
    },
    (operation) => this.#writes.withPermit(operation),
  );

  readonly #dropAgentKey = Effect.fn("HostEvents.dropAgentKey")(function* (
    this: HostEventsService,
    input: EventRoutineRef,
  ) {
    const keys = this.#options.agentKeys;
    if (input.owner.kind !== "agent" || !keys) return;
    yield* removeWebhookSecretKey(keys, input.owner.id, input.id);
  });

  readonly #requireOwner = Effect.fn("HostEvents.requireOwner")(function* (
    this: HostEventsService,
    owner: EventRoutineOwner,
  ) {
    if (yield* eventStep(() => this.#options.routines.ownerExists(owner))) return;
    return yield* eventFailure(
      sourceText(owner.kind === "agent" ? "error.storage.agentMissing" : "error.backend.channelNotFound"),
    );
  });

  readonly #requireRoutine = Effect.fn("HostEvents.requireRoutine")(function* (
    this: HostEventsService,
    ref: EventRoutineRef,
  ) {
    const routine = yield* eventStep(() => this.#options.routines.get(ref.owner, ref.id));
    if (routine) return routine;
    return yield* eventFailure(sourceText("error.backend.routineGone"));
  });
}

export function agentWebhookRoutineWriter(events: HostEventsService): WebhookRoutineWriter {
  const toolFailure = (failure: HostEventsFailure) => {
    const message = hostEventsFailureMessage(failure);
    return new RoutineOperationFailed({ cause: message === null ? failure : new RoutineInputError(message) });
  };
  return {
    delete: ({ agentId, routineId }) =>
      events.deleteRoutine({ owner: { kind: "agent", id: agentId }, id: routineId }).pipe(Effect.mapError(toolFailure)),
  };
}
