import { isString } from "./runtime-values";

export const SIGNAL_HOME_LIST_LIMIT = 32;

const SIGNAL_HOME_ID_PATTERN = /^[a-z0-9-]{1,32}$/u;

export function isSignalHomeId(value: unknown): value is string {
  return isString(value) && SIGNAL_HOME_ID_PATTERN.test(value);
}
