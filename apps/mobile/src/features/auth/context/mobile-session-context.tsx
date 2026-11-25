import type { RelayBrowserIdentity, RelayControlSnapshot } from "@openbot/team-client/relay-client";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { deleteComposerDrafts } from "@/features/chat/model/composer-drafts";
import { deleteLocationAlwaysAllowed } from "@/features/chat/model/location-always-allowed";
import { deleteSideQuestions } from "@/features/chat/model/side-questions";
import { type PhoneIdentityErrorKey, phoneIdentityErrorKey } from "@/features/identity/model/phone-identity";
import { phoneIdentityStore, phoneRelayCrypto } from "@/features/identity/model/phone-platform";
import { type RelayStateKey, relayStateKey } from "@/features/identity/model/phone-relay";
import { PhoneRelayRuntime } from "@/features/identity/model/phone-relay-runtime";
import { deleteAgentBackdrops } from "@/features/settings/model/chat-backdrop";
import { deleteAgentAvatars } from "@/features/workspace/model/agent-avatar-cache";
import type { QueryScope } from "@/features/workspace/model/query-keys";
import { deleteWorkspaceCaches } from "@/features/workspace/model/workspace-cache";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { untilForeground } from "@/shared/lib/until-foreground";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

export type SessionEndKey = PhoneIdentityErrorKey | RelayStateKey;

export interface MobileSession {
  relayUrl: string;
  user: { id: string; name: string };
  identity: RelayBrowserIdentity;
  relay: PhoneRelayRuntime;
}

interface MobileSessionContextValue {
  loading: boolean;
  session: MobileSession | null;
  sessionScope: number;
  endedKey: SessionEndKey | null;
  importIdentity: (text: string) => Promise<void>;
  removeIdentity: () => Promise<void>;
}

const MobileSessionContext = createContext<MobileSessionContextValue | null>(null);

const VENDOR_ACCOUNT_KEYS = [
  "openbot.mobile.session.v1",
  "openbot.mobile.pending-revocations.v1",
  "openbot.mobile.device-id.v1",
];
const LONGEST_TIMER_MS = 2_147_483_647;

function deletePhoneCopy() {
  void deleteWorkspaceCaches();
  deleteAgentBackdrops();
  deleteAgentAvatars();
  deleteLocationAlwaysAllowed();
}

function forgetVendorAccount() {
  for (const key of VENDOR_ACCOUNT_KEYS) void LockedKeychain.deleteItemAsync(key).catch(() => undefined);
}

export function MobileSessionProvider({ children }: PropsWithChildren) {
  const [sessionState, setSessionState] = useState<MobileSession | null | undefined>(undefined);
  const [endedKey, setEndedKey] = useState<SessionEndKey | null>(null);
  const sessionRef = useRef<MobileSession | null>(null);
  const sessionScope = useRef(0);
  const foreground = useAppForeground();

  const endSession = useRef<(key: SessionEndKey | null) => Promise<void>>(async () => undefined);

  const setCurrentSession = useCallback((identity: RelayBrowserIdentity | null) => {
    const previous = sessionRef.current;
    if (previous?.identity.keyId !== identity?.keyId) {
      sessionScope.current += 1;
      deleteComposerDrafts();
      deleteSideQuestions();
    }
    previous?.relay.stop();
    if (previous && !identity) deletePhoneCopy();
    const relayUrl = identity?.relayUrl ?? null;
    const session =
      identity && relayUrl
        ? {
            relayUrl,
            user: { id: identity.keyId, name: identity.user },
            identity,
            relay: new PhoneRelayRuntime({ identity, crypto: phoneRelayCrypto }, (code) => {
              void endSession.current(relayStateKey(code));
            }),
          }
        : null;
    sessionRef.current = session;
    setSessionState(session);
  }, []);

  endSession.current = async (key) => {
    if (!sessionRef.current) return;
    setEndedKey(key);
    await phoneIdentityStore.remove().catch(() => undefined);
    setCurrentSession(null);
  };

  useEffect(() => {
    let active = true;
    const scope = sessionScope.current;
    forgetVendorAccount();
    const read = () =>
      phoneIdentityStore.load().then((identity) => {
        if (!active || scope !== sessionScope.current) return;
        if (!identity) deletePhoneCopy();
        setCurrentSession(identity);
      });
    void read()
      .catch(async (error: unknown) => {
        const key = phoneIdentityErrorKey(error);
        if (key === "mobile.identity.error.storage") return untilForeground().then(read);
        throw error;
      })
      .catch(async (error: unknown) => {
        if (!active || scope !== sessionScope.current) return;
        const key = phoneIdentityErrorKey(error);
        setEndedKey(key);
        if (key !== "mobile.identity.error.storage") {
          await phoneIdentityStore.remove().catch(() => undefined);
          deletePhoneCopy();
        }
        setCurrentSession(null);
      });
    return () => {
      active = false;
    };
  }, [setCurrentSession]);

  const relay = sessionState?.relay ?? null;
  useEffect(() => {
    if (!relay || !foreground) return;
    relay.start();
    return () => relay.stop();
  }, [relay, foreground]);

  const expiresAt = sessionState?.identity.expiresAt ?? null;
  useEffect(() => {
    if (expiresAt === null || !foreground) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      void endSession.current("mobile.identity.error.expired");
      return;
    }
    const timer = setTimeout(
      () => void endSession.current("mobile.identity.error.expired"),
      Math.min(remaining, LONGEST_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, foreground]);

  const importIdentity = useCallback(
    async (text: string) => {
      const identity = await phoneIdentityStore.importText(text);
      if (sessionRef.current && sessionRef.current.identity.keyId !== identity.keyId) deletePhoneCopy();
      setEndedKey(null);
      setCurrentSession(identity);
    },
    [setCurrentSession],
  );

  const removeIdentity = useCallback(async () => {
    await phoneIdentityStore.remove();
    deleteAgentAvatars();
    setEndedKey(null);
    setCurrentSession(null);
  }, [setCurrentSession]);

  const value = useMemo<MobileSessionContextValue>(
    () => ({
      loading: sessionState === undefined,
      session: sessionState ?? null,
      sessionScope: sessionScope.current,
      endedKey,
      importIdentity,
      removeIdentity,
    }),
    [sessionState, endedKey, importIdentity, removeIdentity],
  );

  return <MobileSessionContext.Provider value={value}>{children}</MobileSessionContext.Provider>;
}

export function useMobileSession(): MobileSessionContextValue {
  const value = useContext(MobileSessionContext);
  if (!value) throw new Error("useMobileSession must be used within MobileSessionProvider.");
  return value;
}

export function useQueryScope(): QueryScope {
  const { session, sessionScope } = useMobileSession();
  return [session?.relayUrl, session?.user.id, sessionScope];
}

const STOPPED_RELAY: RelayControlSnapshot = {
  state: { status: "offline", code: "stopped", message: "", retryInMs: null },
  roster: [],
  self: null,
  team: null,
};

const noRelay = () => () => undefined;
const stoppedRelay = () => STOPPED_RELAY;

export function useRelaySnapshot(): RelayControlSnapshot {
  const relay = useMobileSession().session?.relay ?? null;
  return useSyncExternalStore(
    relay?.subscribe ?? noRelay,
    relay?.snapshot ?? stoppedRelay,
    relay?.snapshot ?? stoppedRelay,
  );
}
