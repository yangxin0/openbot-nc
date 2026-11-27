import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { SERVER_SETUP_HEADER, SERVER_SETUP_ROUTES } from "@openbot/contracts/server-setup";

export interface SetupAnswer {
  ok: boolean;
  values: Record<string, string | number>;
}

const NO_ANSWER = "no_answer";

export function setupStatus(): Promise<SetupAnswer> {
  return call("GET", SERVER_SETUP_ROUTES.status);
}

export function text(answer: SetupAnswer, key: string): string | null {
  const value = answer.values[key];
  return isString(value) && value ? value : null;
}

async function call(method: "GET", path: string): Promise<SetupAnswer> {
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { [SERVER_SETUP_HEADER]: "1" },
  };
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, values: answerValues(await response.json()) };
  } catch {
    return { ok: false, values: { error: NO_ANSWER } };
  }
}

function answerValues(value: unknown): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  if (!isDynamicRecord(value)) return values;
  for (const [key, item] of Object.entries(value)) {
    if (isString(item) || isNumber(item)) values[key] = item;
  }
  return values;
}
