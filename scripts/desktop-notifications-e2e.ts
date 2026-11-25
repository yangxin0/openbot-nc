import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentEvent,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  type ServerNotificationLevel,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import { createFormat, translateFor } from "@openbot/i18n";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/desktop-notifications-e2e");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
const english = translateFor("en");

interface RecordedNotification {
  title: string;
  body: string;
  closed: boolean;
  click: () => void;
  timeOut: () => void;
}

const shown: RecordedNotification[] = [];
const opened: unknown[] = [];

plugin({
  name: "desktop-notifications-electron-boundary",
  setup(build) {
    class Inert {}
    class RecordingNotification {
      readonly #record: RecordedNotification;
      readonly #listeners = new Map<string, ((details: { reason?: string }) => void)[]>();
      constructor(options: { title: string; body: string }) {
        this.#record = {
          ...options,
          closed: false,
          click: () => this.#emit("click", {}),
          timeOut: () => this.#emit("close", { reason: "timedOut" }),
        };
      }
      #emit(event: string, details: { reason?: string }) {
        for (const listener of this.#listeners.get(event) ?? []) listener(details);
      }
      static isSupported() {
        return true;
      }
      on(event: string, listener: (details: { reason?: string }) => void) {
        this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
        return this;
      }
      show() {
        shown.push(this.#record);
      }
      close() {
        this.#record.closed = true;
        this.#emit("close", {});
      }
    }
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => APP_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: class UnfocusedWindow {
          static getAllWindows() {
            return [];
          }
          readonly webContents = {
            isDestroyed: () => false,
            isLoadingMainFrame: () => false,
            mainFrame: { isDestroyed: () => false, detached: false },
            send: (channel: string, payload: unknown) => {
              if (channel === IPC_ENDPOINTS.notifications.opened.channel) opened.push(payload);
            },
          };
          isDestroyed() {
            return false;
          }
          isFocused() {
            return false;
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: RecordingNotification,
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: { getAllDisplays: () => [] },
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});
const { RemoteServerManager } = await import("../src/main/remote-server-manager");
const { createRendererForwarders } = await import("../src/main/renderer-forwarders");
const { BrowserWindow } = await import("electron");
const mainWindow = new BrowserWindow();

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "An answer that arrives while a remote server's agent list is read. For the local server the notification shows before the forwarder returns, so no answer can come between.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-desktop-notifications-"));
const userData = join(root, "user-data");
const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};

const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const manager = new RemoteServerManager(join(userData, "remote-servers.json"), cipher, {
  appVersion: APP_VERSION,
});
let agents: AgentService | undefined;
const ownLevels = new Map<string, ServerNotificationLevel>();
function localServer(): ServerSummary {
  const server = manager.list().find((candidate) => candidate.id === LOCAL_SERVER_ID);
  assert.ok(server, "The server list has no local server.");
  return server;
}

async function setLevel(level: ServerNotificationLevel, muted = false): Promise<void> {
  await runCauseEffect(manager.setNotificationLevel(LOCAL_SERVER_ID, level));
  await runCauseEffect(manager.setMuted(LOCAL_SERVER_ID, muted));
  assert.equal(localServer().notificationLevel, level);
  assert.equal(localServer().notificationsMuted, muted);
}

function shownSince(from: number): string[] {
  return shown.slice(from).map((notification) => notification.body);
}

try {
  const agentId = await step("Start the manager, an agent and the forwarder", async () => {
    await runCauseEffect(sidebar.initialize());
    await runCauseEffect(agentStore.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(
      agentStore.createAgent({
        name: "Notification fixture",
        description: "Synthetic agent for the notification check",
        avatarSeed: "desktop-notifications",
        avatarHue: null,
      }),
    );
    agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
    await runCauseEffect(manager.initialize());
    return agent.id;
  });
  const forwarders = createRendererForwarders({
    getMainWindow: () => mainWindow,
    getChatWindows: () => [],
    chatWindowTarget: () => null,
    getAgentService: () => agents ?? null,
    getHostService: () => null,
    getRemoteServerManager: () => manager,
    showMainWindow: () => undefined,
    getTranslate: () => english,
    getFormat: () => createFormat("en"),
    desktopNotificationsEnabled: () => true,
    notificationPreviewEnabled: () => false,
    ownAgentNotificationLevels: () => ownLevels,
  });
  const desktop = (event: AgentEvent) => forwarders.forwardAgentEvent(LOCAL_SERVER_ID, event);
  const ids = { threadId: "thread-1", turnId: "turn-1" };
  const browserStep = (requestId: number): AgentEvent => ({
    type: "browser-takeover-requested",
    request: { requestId, agentId, ...ids, tabId: "tab-1" },
  });
  const prompt = (requestId: number): AgentEvent => ({
    type: "prompt",
    requestId,
    agentId,
    ...ids,
    questions: [{ id: "q", header: "Question", question: "Which one?", options: null, isSecret: false }],
  });
  const startFailure: AgentEvent = { type: "error", agentId, code: "delivery_start_failed", message: "Refused." };
  const finished: AgentEvent = { type: "turn-completed", agentId, ...ids, status: "completed" };
  const routineThreadId = "routine-thread-1";
  const routineFinished: AgentEvent = {
    type: "thread-turn-completed",
    taskId: "routine-task-1",
    routine: true,
    turn: { type: "turn-completed", agentId, threadId: routineThreadId, turnId: "routine-turn-1", status: "completed" },
  };

  const sideThreadFinished: AgentEvent = {
    type: "thread-turn-completed",
    taskId: "side-task-1",
    routine: false,
    turn: { type: "turn-completed", agentId, threadId: "side-thread-1", turnId: "side-turn-1", status: "completed" },
  };

  await step("A browser step notifies, and its end withdraws the notification", async () => {
    await setLevel("all");
    const from = shown.length;
    desktop(browserStep(1));
    assert.deepEqual(shownSince(from), [english("notification.needsBrowserStep")]);
    const notification = shown[from];
    assert.equal(notification?.closed, false);
    desktop({ type: "browser-takeover-resolved", requestId: 1, agentId });
    assert.equal(notification?.closed, true, "The finished browser step left its notification.");
    return { body: notification?.body };
  });

  await step("A run in a routine thread notifies at the level All only, and a click opens its thread", async () => {
    await setLevel("all");
    const from = shown.length;
    desktop(routineFinished);
    assert.deepEqual(shownSince(from), [english("notification.finished")]);
    const opens = opened.length;
    shown[from]?.click();
    assert.deepEqual(opened.slice(opens), [{ serverId: LOCAL_SERVER_ID, agentId, threadId: routineThreadId }]);
    await setLevel("needs-me");
    desktop(routineFinished);
    assert.equal(shown.length, from + 1, "The level Only when it needs me showed a routine run.");
    await setLevel("all");
    return { shown: shownSince(from), opened: opened.slice(opens) };
  });

  await step("A turn of a side thread that is not a routine thread shows no desktop notification", async () => {
    await setLevel("all");
    const from = shown.length;
    desktop(sideThreadFinished);
    desktop(routineFinished);
    assert.deepEqual(shownSince(from), [english("notification.finished")]);
    return { shown: shownSince(from) };
  });

  await step("A message that did not start notifies at the level All only", async () => {
    const from = shown.length;
    desktop(startFailure);
    assert.deepEqual(shownSince(from), [english("notification.failed")]);
    await setLevel("needs-me");
    desktop(startFailure);
    assert.equal(shown.length, from + 1, "The level Only when it needs me showed a start failure.");
    return { shown: shownSince(from) };
  });

  await step("Only when it needs me: requests notify, a finished turn does not", async () => {
    const from = shown.length;
    desktop(finished);
    desktop(prompt(2));
    desktop(browserStep(3));
    assert.deepEqual(shownSince(from), [english("notification.needsInput"), english("notification.needsBrowserStep")]);
    return { shown: shownSince(from) };
  });

  await step("An answer on another device withdraws the question", async () => {
    const question = shown.find((notification) => notification.body === english("notification.needsInput"));
    assert.ok(question);
    desktop({ type: "agent-input-resolved", kind: "approval", requestId: 2, agentId });
    assert.equal(question.closed, false, "An approval answer withdrew a question with the same id.");
    desktop({ type: "agent-input-resolved", kind: "prompt", requestId: 2, agentId });
    assert.equal(question.closed, true, "The answered question left its notification.");
    return { closed: question.closed };
  });

  await step("A request id that comes again replaces the notification before it", async () => {
    const from = shown.length;
    desktop(prompt(4));
    desktop(prompt(4));
    assert.equal(shown.length, from + 2);
    assert.equal(shown[from]?.closed, true, "The earlier notification of the same request stayed.");
    assert.equal(shown[from + 1]?.closed, false);
    return { replaced: shown[from]?.closed };
  });

  await step(
    "A question whose banner timed out into the notification center still leaves when it is answered",
    async () => {
      const from = shown.length;
      desktop(prompt(5));
      const question = shown[from];
      assert.ok(question);
      assert.equal(question.body, english("notification.needsInput"));
      question.timeOut();
      assert.equal(question.closed, false);
      desktop({ type: "agent-input-resolved", kind: "prompt", requestId: 5, agentId });
      assert.equal(question.closed, true, "The answered question stayed in the notification center.");
      return { closed: question.closed };
    },
  );

  await step("Muted or Nothing: no desktop notification", async () => {
    const from = shown.length;
    await setLevel("all", true);
    desktop(browserStep(5));
    desktop(finished);
    await setLevel("nothing");
    desktop(browserStep(6));
    desktop(startFailure);
    assert.deepEqual(shownSince(from), []);
    return { shown: shownSince(from).length };
  });

  await step("The level of an agent replaces the server level on the desktop", async () => {
    const from = shown.length;
    await setLevel("needs-me");
    ownLevels.set(agentId, "all");
    desktop(finished);
    ownLevels.set(agentId, "nothing");
    desktop(prompt(11));
    await setLevel("nothing");
    ownLevels.set(agentId, "all");
    desktop(prompt(12));
    ownLevels.clear();
    assert.deepEqual(shownSince(from), [english("notification.finished")]);
    return { shown: shownSince(from) };
  });

  await step("A hidden agent notifies on the desktop only when it needs the user", async () => {
    const service = agents;
    assert.ok(service);
    const from = shown.length;
    await setLevel("all");
    await runCauseEffect(service.setAgentHidden({ agentId, hidden: true }));
    desktop(finished);
    desktop(startFailure);
    desktop(prompt(18));
    ownLevels.set(agentId, "all");
    desktop(finished);
    ownLevels.clear();
    await runCauseEffect(service.setAgentHidden({ agentId, hidden: false }));
    desktop(startFailure);
    assert.deepEqual(shownSince(from), [
      english("notification.needsInput"),
      english("notification.finished"),
      english("notification.failed"),
    ]);
    return { shown: shownSince(from) };
  });

  report.passed = true;
} finally {
  await runCauseEffect(manager.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
