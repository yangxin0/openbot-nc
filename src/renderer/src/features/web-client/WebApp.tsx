import type { AppVariant } from "@openbot/contracts/ipc";
import { type AppTextKey, formatLocale, resolveLocale } from "@openbot/i18n";
import type { RelayBrowserIdentity, RelayControlSnapshot } from "@openbot/team-client/relay-client";
import { Toaster } from "@openbot/ui";
import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { currentText } from "@openbot/ui/text";
import { Dynamic } from "@solidjs/web";
import { createEffect, createSignal, createStore, onSettled, Show } from "solid-js";
import { StaticI18nProvider } from "../../i18n-context";
import { startupLoadingScene } from "../../startup-animation-preference";
import { clearStorageUsageCache } from "../files/storage-usage";
import { deleteRemoteWorkspaceFrames } from "../servers/remote-workspace-frame";
import { WindowBackdropBubbles } from "../window/backdrop-bubbles";
import { keepCachedWorkflows } from "../workflows/workflow-cache";
import { WebIdentityScreen, type WebIdentitySource } from "./WebIdentityScreen";
import { WebLanguageStep } from "./WebLanguageStep";
import { WebRelayStopped } from "./WebRelayNotice";
import { WebSlowLoadNotice } from "./WebSlowLoadNotice";
import type { WebWorkspace } from "./WebWorkspace";
import { deleteSavedAgentPictures } from "./web-agent-pictures";
import { createWebAppearancePreference } from "./web-appearance-preference";
import { syncWebChatBackground } from "./web-chat-background";
import type { WebRuntimeFactory } from "./web-client-context";
import { deleteCachedWebHosts } from "./web-host-cache";
import { createWebLanguagePreference } from "./web-language-preference";
import {
  identityErrorKey,
  importWebIdentity,
  joinWebIdentity,
  loadWebIdentity,
  openWebIdentityStore,
  relayFinalCode,
  removeWebIdentity,
  startWebRelay,
  type WebRelayRun,
} from "./web-relay";

export { loadSavedLanguage } from "./web-language-preference";

const IDENTITY_CHANNEL = "openbot.web.identity";

let workspaceImport: Promise<typeof WebWorkspace> | null = null;
function loadWorkspace(): Promise<typeof WebWorkspace> {
  if (!workspaceImport) {
    workspaceImport = import("./WebWorkspace").then((module) => module.WebWorkspace);
    workspaceImport.catch(() => {
      workspaceImport = null;
    });
  }
  return workspaceImport;
}

export function WebApp(props: { createRuntime?: WebRuntimeFactory } = {}) {
  return (
    <WindowBackdropBubbles>
      <WebAppContent {...props} />
    </WindowBackdropBubbles>
  );
}

function clearSavedWorkspace(): void {
  deleteRemoteWorkspaceFrames(null);
  void deleteSavedAgentPictures(null);
  keepCachedWorkflows(null);
  deleteCachedWebHosts(null);
  clearStorageUsageCache();
}

function WebAppContent(props: { createRuntime?: WebRuntimeFactory }) {
  const text = currentText();
  const store = openWebIdentityStore();
  const [state, setState] = createStore<{ loaded: boolean; error: AppTextKey | null }>({
    loaded: false,
    error: null,
  });
  const [relay, setRelay] = createSignal<WebRelayRun | null>(null);
  const [relayState, setRelayState] = createSignal<RelayControlSnapshot | null>(null);
  createEffect(relay, (run) => {
    if (!run) {
      setRelayState(null);
      return;
    }
    return run.source.subscribe((next) => setRelayState(() => next));
  });
  const finalCode = () => {
    const snapshot = relayState();
    return snapshot ? relayFinalCode(snapshot) : null;
  };
  let currentIdentity: RelayBrowserIdentity | null = null;
  const [workspace, setWorkspace] = createSignal<typeof WebWorkspace>();
  const [loadingShown, setLoadingShown] = createSignal(true);
  const [languageWheelOpen, setLanguageWheelOpen] = createSignal(false);
  let channel: BroadcastChannel | null = null;
  let disposed = false;
  let loadGeneration = 0;

  async function begin(identity: RelayBrowserIdentity): Promise<void> {
    const view = await loadWorkspace();
    setWorkspace(() => view);
    relay()?.stop();
    currentIdentity = identity;
    setRelay(startWebRelay(identity));
  }

  function retryRelay(): void {
    if (currentIdentity) void begin(currentIdentity);
  }

  async function loadIdentity(): Promise<void> {
    const generation = ++loadGeneration;
    try {
      const identity = await loadWebIdentity(store);
      if (disposed || generation !== loadGeneration) return;
      if (identity) await begin(identity);
      else {
        relay()?.stop();
        setRelay(null);
      }
    } catch (error) {
      if (!disposed && generation === loadGeneration)
        setState((draft) => {
          draft.error = identityErrorKey(error);
        });
    } finally {
      if (!disposed)
        setState((draft) => {
          draft.loaded = true;
        });
    }
  }

  async function importIdentity(source: WebIdentitySource): Promise<void> {
    const identity = await importWebIdentity(store, source);
    loadGeneration += 1;
    clearSavedWorkspace();
    setState((draft) => {
      draft.error = null;
    });
    await begin(identity);
    channel?.postMessage("changed");
  }

  async function joinIdentity(code: string): Promise<void> {
    const identity = await joinWebIdentity(store, code);
    loadGeneration += 1;
    clearSavedWorkspace();
    setState((draft) => {
      draft.error = null;
    });
    await begin(identity);
    channel?.postMessage("changed");
  }

  async function removeIdentity(): Promise<void> {
    loadGeneration += 1;
    relay()?.stop();
    await removeWebIdentity(store);
    clearSavedWorkspace();
    currentIdentity = null;
    setRelay(null);
    channel?.postMessage("changed");
  }

  onSettled(() => {
    channel = new BroadcastChannel(IDENTITY_CHANNEL);
    channel.onmessage = () => {
      relay()?.stop();
      setRelay(null);
      void loadIdentity();
    };
    void loadWorkspace().catch(() => undefined);
    void loadIdentity();
    return () => {
      disposed = true;
      channel?.close();
      relay()?.stop();
    };
  });
  const variant: AppVariant = import.meta.env.DEV ? "dev" : "production";
  const languagePreference = createWebLanguagePreference();
  const appearancePreference = createWebAppearancePreference();
  onSettled(() => syncWebChatBackground());
  return (
    <StaticI18nProvider
      locale={resolveLocale(languagePreference.language(), navigator.language)}
      formatLocale={formatLocale(languagePreference.language(), navigator.language)}
    >
      <div class="web-app">
        <Toaster />
        <Show when={state.loaded}>
          <Show
            keyed
            when={relay()}
            fallback={
              <Show
                when={!languageWheelOpen()}
                fallback={
                  <WebLanguageStep
                    variant={variant}
                    language={languagePreference.language()}
                    onChangeLanguage={languagePreference.setLanguage}
                    onDone={() => setLanguageWheelOpen(false)}
                  />
                }
              >
                <WebIdentityScreen
                  variant={variant}
                  language={resolveLocale(languagePreference.language(), navigator.language)}
                  appearance={appearancePreference.appearance()}
                  error={state.error}
                  onImport={importIdentity}
                  onJoin={joinIdentity}
                  onChangeLanguage={() => setLanguageWheelOpen(true)}
                  onChangeAppearance={appearancePreference.setAppearance}
                />
              </Show>
            }
          >
            {(connection) => (
              <Show
                keyed
                when={finalCode()}
                fallback={
                  <Dynamic
                    component={workspace()}
                    accountId={connection.identity.keyId}
                    accountName={connection.identity.user}
                    relay={connection}
                    onRemoveIdentity={removeIdentity}
                    onJoinIdentity={joinIdentity}
                    createRuntime={props.createRuntime}
                    language={languagePreference.language()}
                    onChangeLanguage={languagePreference.setLanguage}
                    appearance={appearancePreference.appearance()}
                    onChangeAppearance={appearancePreference.setAppearance}
                  />
                }
              >
                {(code) => (
                  <WebRelayStopped
                    code={code}
                    variant={variant}
                    onRetry={retryRelay}
                    onRemoveIdentity={removeIdentity}
                  />
                )}
              </Show>
            )}
          </Show>
        </Show>
        <Show when={loadingShown()}>
          <AppLoadingScreen
            label={text.t("app.loading")}
            title={text.t("app.loading")}
            scene={startupLoadingScene()}
            ready={state.loaded}
            onExited={() => {
              setLoadingShown(false);
              void loadWorkspace().catch(() => undefined);
            }}
          />
        </Show>
        <Show when={!state.loaded}>
          <WebSlowLoadNotice />
        </Show>
      </div>
    </StaticI18nProvider>
  );
}
