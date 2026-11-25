import { APP_NAME } from "@openbot/contracts/app-identity";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import { AppState } from "react-native";
import { nativeApplicationVersion, nativeBuildVersion } from "@/shared/lib/native-application";
import { installPhoneNetwork, phoneNetwork } from "./phone-network-capture";
import {
  formatSupportLogEntry,
  parseSupportLog,
  parseSupportLogCache,
  SUPPORT_LOG_CACHE_LINES,
  type SupportLogLevel,
  supportLog,
  supportLogCacheLines,
  supportLogCacheText,
  supportLogValue,
  withRequestLog,
} from "./support-log";
import { installSystemState } from "./system-state-capture";

const CACHE_FILE = "support-log-v2.jsonl";
const LEGACY_CACHE_FILE = "support-log-v1.json";
const PERSIST_DELAY_MS = 10_000;
let installed = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let restored = false;
let rewrite = true;
let cacheLines = 0;

function redactionKey(): string | null {
  if (__DEV__) return null;
  return appVersion();
}

function cacheFile(): File {
  return new File(Paths.cache, CACHE_FILE);
}

function legacyCacheFile(): File {
  return new File(Paths.cache, LEGACY_CACHE_FILE);
}

function restoreText(cache: string | null, legacy: string | null): void {
  if (cache !== null) {
    const parsed = parseSupportLogCache(cache, redactionKey());
    cacheLines = parsed.lines;
    rewrite = parsed.rewrite;
    supportLog.restore(parsed.entries);
  } else if (legacy !== null) {
    supportLog.restore(parseSupportLog(legacy));
  }
}

function restoreNow(): void {
  if (restored) return;
  restored = true;
  try {
    const file = cacheFile();
    if (file.exists) restoreText(file.textSync(), null);
    else {
      const legacy = legacyCacheFile();
      if (legacy.exists) restoreText(null, legacy.textSync());
    }
  } catch {}
}

function restoreWhenIdle(): void {
  requestIdleCallback(() => {
    if (restored) return;
    let text: Promise<[string | null, string | null]>;
    try {
      const file = cacheFile();
      const legacy = legacyCacheFile();
      text = file.exists
        ? file.text().then((value): [string, null] => [value, null])
        : legacy.exists
          ? legacy.text().then((value): [null, string] => [null, value])
          : Promise.resolve<[null, null]>([null, null]);
    } catch {
      restored = true;
      return;
    }
    void text.then(
      ([cache, legacy]) => {
        if (restored) return;
        restored = true;
        restoreText(cache, legacy);
      },
      () => {
        restored = true;
      },
    );
  });
}

function persist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  restoreNow();
  try {
    const file = cacheFile();
    const unsaved = supportLog.unsaved();
    if (rewrite || !file.exists || cacheLines + unsaved.length > SUPPORT_LOG_CACHE_LINES) {
      const entries = supportLog.entries();
      file.writeSync(supportLogCacheText(redactionKey(), entries));
      cacheLines = entries.length;
      rewrite = false;
      const legacy = legacyCacheFile();
      if (legacy.exists) legacy.delete();
    } else if (unsaved.length > 0) {
      file.writeSync(supportLogCacheLines(unsaved), { append: true });
      cacheLines += unsaved.length;
    }
    supportLog.markSaved();
  } catch {
    rewrite = true;
  }
}

function schedulePersist(): void {
  persistTimer ??= setTimeout(persist, PERSIST_DELAY_MS);
}

function appVersion(): string {
  const version = nativeApplicationVersion() ?? "development";
  const build = nativeBuildVersion();
  return build ? `${version} (${build})` : version;
}

function systemName(): string {
  const { modelName, modelId } = Device;
  const model =
    modelName && modelId && modelName !== modelId ? `${modelName} (${modelId})` : (modelName ?? modelId ?? "unknown");
  return `${Device.osName ?? "unknown"} ${Device.osVersion ?? ""}, ${model}`;
}

export function supportLogFileText(): string {
  const entries = supportLog.entries();
  return [
    `${APP_NAME} support log`,
    `Saved: ${new Date().toISOString()}`,
    `App: ${appVersion()}`,
    `System: ${systemName()}`,
    `Network: ${phoneNetwork()}`,
    `Entries: ${entries.length}`,
    "",
    ...entries.map(formatSupportLogEntry),
    "",
  ].join("\n");
}

export function clearSupportLog(): void {
  restored = true;
  supportLog.clear();
  rewrite = true;
  persist();
}

function captureConsole(): void {
  let capturing = false;
  for (const level of ["warn", "error"] as const satisfies readonly SupportLogLevel[]) {
    const original = console[level];
    console[level] = (...values: unknown[]) => {
      if (!capturing) {
        capturing = true;
        try {
          supportLog.add(level, "console", values.map(supportLogValue).join(" "));
        } finally {
          capturing = false;
        }
      }
      original(...values);
    };
  }
}

function captureErrors(): void {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    supportLog.add("error", "app", `${isFatal ? "Fatal error" : "Uncaught error"}: ${supportLogValue(error)}`);
    if (isFatal) persist();
    previous(error, isFatal);
  });
}

function captureFetch(): void {
  const original = globalThis.fetch;
  const fetchWithLog = withRequestLog((input: RequestInfo | URL, init?: RequestInit) => original(input, init));
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: fetchWithLog,
  });
}

export function installSupportLog(): void {
  if (installed) return;
  installed = true;
  restoreWhenIdle();
  supportLog.subscribe(schedulePersist);
  supportLog.add("info", "app", `Started ${APP_NAME} ${appVersion()} on ${systemName()}`);
  captureConsole();
  captureErrors();
  captureFetch();
  installPhoneNetwork();
  installSystemState();
  AppState.addEventListener("change", (state) => {
    supportLog.add("info", "app", `App state: ${state}`);
    if (state === "background") persist();
  });
}
