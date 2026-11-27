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
  join: "settings.team.error.join",
  remove: "settings.team.error.remove",
  hosting: "settings.team.error.hosting",
  unhide: "settings.team.error.unhide",
} as const satisfies Record<TeamAction, AppTextKey>;

type RelayJoinRequest = { code: string; replaceConfirmed: boolean };

interface RelayView {
  joinRequest: RelayJoinRequest | null;
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
      joinRequest: null,
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

    function requestJoin(code: string): void {
      setView((draft) => {
        draft.error = null;
        draft.joinRequest = { code, replaceConfirmed: false };
      });
    }

    async function joinWithCode(code: string, replace: boolean): Promise<boolean> {
      const call = () => (replace ? relayPort().relay.replaceWithCode(code) : relayPort().relay.joinWithCode(code));
      return run("join", call, apply);
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
      joinWithCode,
      requestJoin,
      joinStage: (): "confirm" | "code" | null => {
        const request = view.joinRequest;
        if (!request) return null;
        return view.state?.identity && !request.replaceConfirmed ? "confirm" : "code";
      },
      confirmJoinReplace: () =>
        setView((draft) => {
          if (draft.joinRequest) draft.joinRequest.replaceConfirmed = true;
        }),
      closeJoin: () =>
        setView((draft) => {
          draft.joinRequest = null;
          if (draft.error?.action === "join") draft.error = null;
        }),
      joinRequested: async (code: string) => {
        const replace = Boolean(view.state?.identity);
        if (replace && !view.joinRequest?.replaceConfirmed) return false;
        const joined = await joinWithCode(code, replace);
        if (joined)
          setView((draft) => {
            draft.joinRequest = null;
          });
        return joined;
      },
      removeIdentity: () => run("remove", () => relayPort().relay.removeIdentity(), apply),
      setHosting: (enabled: boolean) => run("hosting", () => relayPort().relay.setHosting(enabled), apply),
      unhideHost: (serverId: string) => run("unhide", () => relayPort().relay.unhideHost(serverId), apply, serverId),
    };
  },
});

export const RelayProvider = Relay.provider;
export const useRelay = Relay.use;
