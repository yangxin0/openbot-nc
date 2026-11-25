import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type {
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRun,
  EventStatus,
  ListEventRoutineRunsInput,
  SaveEventRoutineInput,
} from "@openbot/contracts/ipc-events";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

function sameOwner(left: EventRoutineOwner, right: EventRoutineOwner): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export function createMockEvents(
  listRuns: (input: ListEventRoutineRunsInput) => Promise<EventRoutineRun[]>,
): OpenBotDesktopApi["events"] {
  let routines: EventRoutine[] = [];
  let sequence = 0;
  const status: EventStatus = { supported: true, connected: false };
  const nextId = (prefix: string) => `${prefix}-${++sequence}`;
  const findRoutine = (id: string, owner: EventRoutineOwner) =>
    routines.find((routine) => routine.id === id && sameOwner(routine.owner, owner));

  return {
    getStatus: async () => clone(status),
    listRoutines: async ({ owner }) => clone(routines.filter((routine) => sameOwner(routine.owner, owner))),
    saveRoutine: async (input: SaveEventRoutineInput) => {
      if (input.trigger.kind !== "schedule") throw new Error(sourceText("error.backend.webhooksRemoved"));
      const now = new Date().toISOString();
      const existing = input.id ? findRoutine(input.id, input.owner) : undefined;
      const id = existing?.id ?? input.id ?? nextId("routine");
      const routine: EventRoutine = {
        id,
        owner: clone(input.owner),
        name: input.name,
        instruction: input.instruction,
        active: input.active,
        timezone: input.timezone,
        trigger: clone(input.trigger),
        ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
        ...(input.missedPolicy === undefined ? {} : { missedPolicy: input.missedPolicy }),
        ...(input.owner.kind === "agent" ? { runIn: input.runIn ?? existing?.runIn ?? "chat" } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      routines = existing ? routines.map((item) => (item.id === id ? routine : item)) : [routine, ...routines];
      return { routine: clone(routine), secret: null };
    },
    deleteRoutine: async ({ id, owner }) => {
      routines = routines.filter((routine) => !(routine.id === id && sameOwner(routine.owner, owner)));
    },
    testRoutine: async () => {},
    listActivity: async () => [],
    listRoutineRuns: async (input) => {
      if (!findRoutine(input.routineId, input.owner)) throw new Error("Routine not found.");
      return listRuns(input);
    },
  };
}
