import type { RelayImportResult, RelayState } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { TeamAction, TeamActionError } from "@openbot/ui/features/settings/SettingsTeamTab";
import { currentText } from "@openbot/ui/text";
import { createStore, flush, onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { relayPort } from "./relay-port";

const FAILURE_KEYS = {
  import: "settings.team.error.import",
  replace: "settings.team.error.import",
  remove: "settings.team.error.remove",
  hosting: "settings.team.error.hosting",
  unhide: "settings.team.error.unhide",
} as const satisfies Record<TeamAction, AppTextKey>;

interface RelayView {
  state: RelayState | null;
  receivedAt: number;
  loadError: string | null;
  busy: TeamAction | null;
  unhidingServerId: string | null;
  error: TeamActionError | null;
}

const Relay = createSimpleContext({
  name: "Relay",
  init: () => {
    const [view, setView] = createStore<RelayView>({
      state: null,
      receivedAt: 0,
      loadError: null,
      busy: null,
      unhidingServerId: null,
      error: null,
    });
    let eventSeen = false;

    function apply(next: RelayState): void {
      setView((draft) => {
        draft.state = next;
        draft.receivedAt = Date.now();
        draft.loadError = null;
      });
    }

    function applyImport(result: RelayImportResult): void {
      if (result.status === "imported") apply(result.state);
    }

    async function load(): Promise<void> {
      try {
        const state = await relayPort().relay.getState();
        if (!eventSeen) apply(state);
      } catch (error) {
        const text = currentText();
        setView((draft) => {
          draft.loadError = text.errorMessage(error, text.t("settings.team.error.load"));
        });
      }
    }

    async function run<Result>(
      action: TeamAction,
      call: () => Promise<Result>,
      done: (result: Result) => void,
      serverId: string | null = null,
    ): Promise<boolean> {
      if (view.busy !== null) return false;
      setView((draft) => {
        draft.busy = action;
        draft.unhidingServerId = serverId;
        draft.error = null;
      });
      try {
        done(await call());
        return true;
      } catch (error) {
        const text = currentText();
        setView((draft) => {
          draft.error = { action, message: text.errorMessage(error, text.t(FAILURE_KEYS[action])) };
        });
        return false;
      } finally {
        setView((draft) => {
          draft.busy = null;
          draft.unhidingServerId = null;
        });
      }
    }

    onSettled(() => {
      const unsubscribe = relayPort().relay.onState((state) => {
        eventSeen = true;
        flush(() => apply(state));
      });
      void load();
      return unsubscribe;
    });

    return {
      view,
      hasIdentity: () => Boolean(view.state?.identity),
      reload: () => {
        eventSeen = false;
        return load();
      },
      importIdentity: () => run("import", () => relayPort().relay.importIdentity(), applyImport),
      replaceIdentity: () => run("replace", () => relayPort().relay.replaceIdentity(), applyImport),
      removeIdentity: () => run("remove", () => relayPort().relay.removeIdentity(), apply),
      setHosting: (enabled: boolean) => run("hosting", () => relayPort().relay.setHosting(enabled), apply),
      unhideHost: (serverId: string) => run("unhide", () => relayPort().relay.unhideHost(serverId), apply, serverId),
    };
  },
});

export const RelayProvider = Relay.provider;
export const useRelay = Relay.use;
