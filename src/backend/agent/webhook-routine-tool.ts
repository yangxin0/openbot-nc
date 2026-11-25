import type { EventFilter } from "@openbot/contracts/ipc-events";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import type { RoutineOperationFailed } from "./routine-scheduler";

export interface WebhookRoutineWriter {
  delete(input: { agentId: string; routineId: string }): Effect.Effect<void, RoutineOperationFailed>;
}

export function webhookSecretKeyName(routineId: string): string {
  return `WEBHOOK_SECRET_${routineId.replaceAll("-", "").toUpperCase()}`;
}

const logger = createOpenBotLogger("webhook-routine");

export interface WebhookSecretKeys {
  has(agentId: string, name: string): Effect.Effect<boolean, unknown>;
  remove(agentId: string, name: string): Effect.Effect<unknown, unknown>;
}

export function removeWebhookSecretKey(
  keys: WebhookSecretKeys,
  agentId: string,
  routineId: string,
): Effect.Effect<void> {
  const name = webhookSecretKeyName(routineId);
  return keys.has(agentId, name).pipe(
    Effect.flatMap((has) => (has ? keys.remove(agentId, name).pipe(Effect.asVoid) : Effect.void)),
    Effect.catch(() =>
      Effect.sync(() => logger.warn("The key of an old webhook routine signing secret was not removed.")),
    ),
  );
}

export function webhookRoutineSummary(routine: {
  id: string;
  name: string;
  active: boolean;
  trigger: { eventType: string | null; filters: EventFilter[]; url: string | null };
}) {
  const { eventType, filters, url } = routine.trigger;
  return { routineId: routine.id, name: routine.name, active: routine.active, eventType, filters, url };
}
