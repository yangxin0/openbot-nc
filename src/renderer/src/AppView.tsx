import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { UpdateRequiredScreen } from "@openbot/ui/features/updates/UpdateRequiredScreen";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Loading, Show } from "solid-js";
import { profileAccount, useAuth } from "./features/account/account-context";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import { createLanguageStep } from "./features/onboarding/language-step";
import { useSetup } from "./features/onboarding/onboarding-context";
import { SetupReadError } from "./features/onboarding/SetupReadError";
import { useSetupProviderProps } from "./features/onboarding/setup-provider-props";
import { RelayJoinCodeHost } from "./features/relay/RelayJoinCodeHost";
import { useRelay } from "./features/relay/relay-context";
import { useServerScope } from "./features/servers/server-scope";
import { useServerSelection } from "./features/servers/server-selection";
import { useServers } from "./features/servers/servers-context";
import { useUpdates } from "./features/updates/updates-context";
import { WhatsNewOverlay } from "./features/updates/WhatsNewOverlay";
import { QuitShortcutHint } from "./features/window/QuitShortcutHint";
import { startsAfterRestart } from "./features/window/restarted-start";
import { useI18n } from "./i18n-context";
import { FirstRunFlow, LanguageStep } from "./lazy-views";
import { usePlatform } from "./platform";
import { reportWorkspaceReady } from "./renderer-timing";
import { startupLoadingScene } from "./startup-animation-preference";
import { WorkspaceShell } from "./WorkspaceShell";

let startupSplashPlayed = false;

export function skipStartupSplash(): void {
  startupSplashPlayed = true;
}

function LoadingScreen() {
  const { t } = useText();
  return <div class="initial-setup-screen" role="status" aria-label={t("app.loading")} />;
}

export function AppAccessGate() {
  const { t } = useText();
  const platform = usePlatform();
  const i18n = useI18n();
  const auth = useAuth();
  const account = createMemo(() => {
    const profile = auth.profile();
    return profile ? profileAccount(profile) : null;
  });
  const setup = useSetup();
  const scope = useServerScope();
  const setupProviders = useSetupProviderProps();
  const detection = useProviderDetection();
  const { openServerDuringSetup } = useServerSelection();
  const relay = useRelay();
  const { servers } = useServers();
  const accountServers = createMemo(() =>
    servers().filter((server) => server.kind === "remote" && server.thisComputer !== true),
  );
  const updates = useUpdates();
  const [requiredUpdateDismissed, setRequiredUpdateDismissed] = createSignal(false);
  const updateRequired = () => updates.status().requiredVersion !== undefined && !requiredUpdateDismissed();
  const languageLoaded = createMemo<boolean>((was) => was === true || i18n.ready());
  const started = () => setup.setupLoaded() && platform.appInfo() !== null && languageLoaded();
  const [splashShown, setSplashShown] = createSignal(!platform.landingPreview && !startsAfterRestart());
  const splashExit = () => {
    if (platform.chatWindow !== null) return undefined;
    return !startupSplashPlayed && setup.setupState()?.completed !== true ? "playToEnd" : "fade";
  };
  const [splashOpen, setSplashOpen] = createSignal(false);
  const splashMoving = () => splashShown() && !splashOpen();
  const [workspaceReady, setWorkspaceReady] = createSignal(false);
  const languageStep = createLanguageStep();
  const languageStepShown = () =>
    !languageStep.done() && (languageStep.reopened() || setup.setupState()?.completed === false);
  createEffect(
    () => setup.setupState()?.completed === true,
    (completed) => {
      if (completed && !languageStep.done()) languageStep.complete();
    },
  );
  const workspaceShown = () =>
    !languageStepShown() && !!account() && (setup.setupState()?.completed === true || !scope.connection.hasContent);
  const splashReady = () =>
    started() && account() !== null && (!workspaceShown() || workspaceReady() || updateRequired());
  createEffect(started, (ready) => {
    if (ready) performance.mark("openbot:app-started");
  });
  createEffect(workspaceReady, (ready) => {
    if (ready && platform.chatWindow === null) reportWorkspaceReady();
  });

  return (
    <>
      <Show when={started() && updateRequired()}>
        <UpdateRequiredScreen
          status={updates.status()}
          logoVariant={platform.appInfo()?.variant ?? "production"}
          onUpdate={updates.runAction}
          onDismiss={() => setRequiredUpdateDismissed(true)}
        />
      </Show>
      <Show when={started() && !updateRequired()}>
        <Show
          when={!languageStepShown() && account()}
          fallback={
            <Loading fallback={<LoadingScreen />}>
              <Show when={languageStepShown()} fallback={<LoadingScreen />}>
                <LanguageStep
                  variant={platform.appInfo()?.variant ?? "production"}
                  reopened={languageStep.reopened()}
                  onDone={languageStep.complete}
                />
              </Show>
            </Loading>
          }
        >
          {(account) => (
            <Show
              when={setup.setupState()?.completed}
              fallback={
                <Show
                  when={scope.connection.hasContent}
                  fallback={
                    <WorkspaceShell
                      account={account}
                      behindSplash={splashMoving}
                      onStartupReady={() => setWorkspaceReady(true)}
                    />
                  }
                >
                  <Show when={!setup.setupReadFailed()} fallback={<SetupReadError />}>
                    <Loading fallback={<LoadingScreen />}>
                      <FirstRunFlow
                        {...setupProviders}
                        state={
                          setup.setupState() ?? { completed: false, preferredProvider: null, preferredModel: null }
                        }
                        platform={platform.appInfo()?.platform ?? "darwin"}
                        onSave={setup.saveSetup}
                        onProviderStepShown={detection.scanOnce}
                        logoVariant={platform.appInfo()?.variant ?? "production"}
                        existingServers={accountServers()}
                        onOpenServer={openServerDuringSetup}
                        teamName={relay.view.state?.identity?.team ?? null}
                        teamBusy={relay.view.busy === "import" || relay.view.busy === "join"}
                        teamError={relay.view.error?.action === "import" ? relay.view.error.message : null}
                        onConnectTeam={platform.landingPreview ? undefined : () => void relay.importIdentity()}
                        onJoinTeamWithCode={platform.landingPreview ? undefined : () => relay.requestJoin("")}
                      />
                    </Loading>
                  </Show>
                </Show>
              }
            >
              <WorkspaceShell
                account={account}
                behindSplash={splashMoving}
                onStartupReady={() => setWorkspaceReady(true)}
              />
            </Show>
          )}
        </Show>
      </Show>
      <WhatsNewOverlay ready={!platform.chatWindow && !updateRequired() && !splashShown() && workspaceShown()} />
      <QuitShortcutHint />
      <Show when={!platform.chatWindow && !platform.landingPreview}>
        <RelayJoinCodeHost />
      </Show>
      <Show when={splashShown()}>
        <AppLoadingScreen
          label={t("app.loading")}
          title={t("app.loading")}
          scene={startupLoadingScene()}
          ready={splashReady()}
          exit={splashExit()}
          onMountViews={() => setSplashOpen(true)}
          onExited={() => {
            startupSplashPlayed = true;
            setSplashShown(false);
          }}
        />
      </Show>
    </>
  );
}
