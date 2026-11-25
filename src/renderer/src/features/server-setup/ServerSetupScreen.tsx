import { AppLogo } from "@openbot/brand";
import { APP_NAME } from "@openbot/contracts/app-identity";
import type { AppVariant } from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, onCleanup, onSettled, Show } from "solid-js";
import { type SetupAnswer, setupStatus, text } from "./server-setup-port";

const PRODUCT_NAME = APP_NAME;
const DEFAULT_SERVER_NAME = APP_NAME;
const IMPORT_COMMAND = "openbot import-identity <file>";
const HOSTING_COMMAND = "openbot hosting on";
const STATUS_POLL_MS = 2_000;
const ERROR_POLL_MS = 10_000;

interface MemberView {
  team: string;
  user: string;
  name: string;
  online: boolean;
  hosting: boolean;
  message: string | null;
}

type SetupView =
  | { kind: "loading" }
  | { kind: "no_answer" }
  | { kind: "identity_missing" }
  | { kind: "identity_unusable"; message: string | null }
  | { kind: "member"; member: MemberView };

export function ServerSetupScreen() {
  const { t, sourceText } = useText();
  const variant: AppVariant = import.meta.env.DEV ? "dev" : "production";
  const [state, setState] = createStore<{ view: SetupView }>({ view: { kind: "loading" } });
  let pollTimer: number | undefined;

  onCleanup(() => window.clearTimeout(pollTimer));
  onSettled(() => void refresh());
  createEffect(
    () => t("server.setup.pageTitle"),
    (title) => {
      document.title = title;
    },
  );

  function poll(delay: number): void {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => void refresh(), delay);
  }

  function viewOf(answer: SetupAnswer): SetupView {
    if (!answer.ok) return { kind: "no_answer" };
    const identity = text(answer, "identity");
    if (identity === "missing") return { kind: "identity_missing" };
    if (identity !== "ready") return { kind: "identity_unusable", message: text(answer, "identity_message") };
    return {
      kind: "member",
      member: {
        team: text(answer, "team") ?? "",
        user: text(answer, "user") ?? "",
        name: text(answer, "server_name") ?? DEFAULT_SERVER_NAME,
        online: text(answer, "hosting_state") === "online",
        hosting: text(answer, "hosting") === "on",
        message: text(answer, "server_message"),
      },
    };
  }

  async function refresh(): Promise<void> {
    const view = viewOf(await setupStatus());
    setState((draft) => {
      draft.view = view;
    });
    if (view.kind === "no_answer") poll(ERROR_POLL_MS);
    else if (view.kind !== "member" || !view.member.online) poll(STATUS_POLL_MS);
  }

  function command(value: string): JSX.Element {
    return (
      <p class="account-login-description">
        <code>{value}</code>
      </p>
    );
  }

  function member(): MemberView | null {
    const view = state.view;
    return view.kind === "member" ? view.member : null;
  }

  function unusableMessage(): string | null {
    const view = state.view;
    return view.kind === "identity_unusable" ? view.message : null;
  }

  return (
    <main class="account-login-screen">
      <div class="account-login-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={variant} animation="blink" interactive class="account-login-logo" />
          <span class="account-login-wordmark">{PRODUCT_NAME}</span>
        </header>
        <section class="account-login" aria-labelledby="server-setup-title" aria-live="polite">
          <Show
            when={member()}
            fallback={
              <>
                <h1 id="server-setup-title" class="account-login-title">
                  {t("server.setup.identityTitle")}
                </h1>
                <Show when={state.view.kind === "no_answer"}>
                  <p class="account-login-error">{t("server.setup.errorNoAnswer")}</p>
                </Show>
                <Show when={state.view.kind === "identity_unusable"}>
                  <p class="account-login-error">
                    {sourceText(unusableMessage() ?? t("server.setup.identityUnusable"))}
                  </p>
                </Show>
                <p class="account-login-description">{t("server.setup.identityHelp")}</p>
                {command(IMPORT_COMMAND)}
              </>
            }
          >
            {(view) => (
              <>
                <h1 id="server-setup-title" class="account-login-title">
                  {!view().hosting
                    ? t("server.setup.notShared", { name: view().name })
                    : view().online
                      ? t("server.setup.online", { name: view().name })
                      : t("server.setup.starting", { name: view().name })}
                </h1>
                <p class="account-login-description">
                  {t("server.setup.teamMember", { team: view().team, user: view().user })}
                </p>
                <Show
                  when={view().hosting}
                  fallback={
                    <>
                      <p class="account-login-description">{t("server.setup.hostingOff")}</p>
                      {command(HOSTING_COMMAND)}
                    </>
                  }
                >
                  <Show when={!view().online}>
                    <div class="account-login-loader" role="status">
                      <span class="account-login-spinner" aria-hidden="true" />
                      <Show when={view().message}>
                        {(message) => <span class="account-login-error">{sourceText(message())}</span>}
                      </Show>
                    </div>
                  </Show>
                </Show>
              </>
            )}
          </Show>
        </section>
      </div>
    </main>
  );
}
