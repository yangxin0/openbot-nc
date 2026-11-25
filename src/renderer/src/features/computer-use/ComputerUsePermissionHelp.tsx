import { APP_NAME } from "@openbot/contracts/app-identity";
import type { ComputerUsePermissionApp, MacPermissionId } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, FolderOpen, GripVertical, Monitor, MousePointer2 } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { computerUsePort } from "./computer-use-port";

const PERMISSION_HELP: Record<MacPermissionId, { title: AppTextKey; pane: AppTextKey; icon: typeof Monitor }> = {
  "screen-recording": {
    title: "computerUse.permission.screenRecording.title",
    pane: "computerUse.permission.screenRecording.pane",
    icon: Monitor,
  },
  accessibility: {
    title: "computerUse.permission.accessibility.title",
    pane: "computerUse.permission.accessibility.pane",
    icon: MousePointer2,
  },
};

const OPENBOT_APP_NAME = APP_NAME;

const POLL_INTERVAL_MS = 1_000;

export function permissionFromQuery(search: string): MacPermissionId {
  return new URLSearchParams(search).get("permission") === "accessibility" ? "accessibility" : "screen-recording";
}

export function ComputerUsePermissionHelp(props: { permission: MacPermissionId }) {
  const { t, errorMessage } = useText();
  const permission = props.permission;
  const help = PERMISSION_HELP[permission];
  const PermissionIcon = help.icon;
  const [granted, setGranted] = createSignal(false);
  const [app, setApp] = createSignal<ComputerUsePermissionApp | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;
  let reading = false;

  function close(): void {
    void computerUsePort().computerUse.closePermissionHelp();
  }

  async function read(): Promise<void> {
    if (reading || disposed) return;
    reading = true;
    try {
      const state = await computerUsePort().computerUse.getState();
      if (!disposed) setGranted(state.permissions.some((entry) => entry.id === permission && entry.granted));
    } catch {
    } finally {
      reading = false;
    }
  }

  async function readApp(): Promise<void> {
    try {
      const next = await computerUsePort().computerUse.getPermissionApp();
      if (!disposed) setApp(next);
    } catch {}
  }

  async function reveal(): Promise<void> {
    setError(null);
    try {
      await computerUsePort().computerUse.revealPermissionApp();
    } catch (cause) {
      setError(errorMessage(cause, t("computerUse.help.revealFailed")));
    }
  }

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  window.addEventListener("keydown", closeOnEscape);
  const timer = setInterval(() => void read(), POLL_INTERVAL_MS);

  onSettled(() => {
    void read();
    void readApp();
  });
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("keydown", closeOnEscape);
  });

  return (
    <main class="computer-use-help" aria-labelledby="computer-use-help-title">
      <header class="computer-use-help-header">
        <span class="computer-use-help-icon" aria-hidden="true">
          <PermissionIcon />
        </span>
        <div>
          <h1 id="computer-use-help-title">{t("computerUse.help.title", { permission: t(help.title) })}</h1>
          <p>{t("computerUse.help.paneOpen", { pane: t(help.pane) })}</p>
        </div>
      </header>

      <Show when={app()}>
        {(bundle) => (
          <Button
            type="button"
            variant="ghost"
            class={`computer-use-drag-card${dragging() ? " is-dragging" : ""}`}
            draggable="true"
            aria-label={t("computerUse.help.dragLabel", { name: bundle().name })}
            onClick={() => void reveal()}
            onDragStart={(event) => {
              event.preventDefault();
              setDragging(true);
              setError(null);
              void computerUsePort()
                .computerUse.startPermissionAppDrag()
                .catch((cause) => setError(errorMessage(cause, t("computerUse.help.dragFailed"))))
                .finally(() => setDragging(false));
            }}
            onDragEnd={() => setDragging(false)}
          >
            <span class="computer-use-drag-handle" aria-hidden="true">
              <GripVertical />
            </span>
            <span class="computer-use-drag-icon" aria-hidden="true">
              <Show when={bundle().iconDataUrl} fallback={<Monitor />}>
                {(source) => <img src={source()} alt="" />}
              </Show>
            </span>
            <strong>{`${bundle().name}.app`}</strong>
            <span>{t("computerUse.help.dragToAdd")}</span>
          </Button>
        )}
      </Show>

      <ol class="computer-use-help-steps">
        <li>
          <Show when={app()} fallback={t("computerUse.help.findInList", { name: OPENBOT_APP_NAME })}>
            {(bundle) => t("computerUse.help.dragIntoList", { name: bundle().name })}
          </Show>
        </li>
        <li>{t("computerUse.help.turnOn")}</li>
      </ol>

      <Show when={error()}>
        {(message) => (
          <p class="computer-use-help-status is-error" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <footer class="computer-use-help-footer">
        <Show when={app()}>
          <Button type="button" variant="outline" size="sm" onClick={() => void reveal()}>
            <FolderOpen aria-hidden="true" />
            {t("computerUse.help.showInFinder")}
          </Button>
        </Show>
        <Button type="button" variant={granted() ? "default" : "outline"} size="sm" onClick={close}>
          {t("common.done")}
        </Button>
      </footer>
    </main>
  );
}
