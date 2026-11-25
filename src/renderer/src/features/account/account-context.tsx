import {
  type AccountUsage,
  type AccountUsageLimit,
  type AvatarColor,
  type AvatarImageInput,
  type CentralAuthState,
  keepUsageCredits,
  withReadCredits,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createMemo, createSignal, createStore, flush, onCleanup, onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { accountPort } from "./account-port";

const AUTH_SUCCESS_HOLD_MS = 600;

const Auth = createSimpleContext({
  name: "Auth",
  init: () => {
    const [centralAuth, setCentralAuth] = createSignal<CentralAuthState>({ status: "loading" });
    const [authSuccessVisible, setAuthSuccessVisible] = createSignal(false);
    const [accountUsageState, setAccountUsageState] = createStore<{
      targetKey: string | null;
      data: AccountUsage | null;
      refreshRevision: number;
    }>({ targetKey: null, data: null, refreshRevision: 0 });
    let accountUsageRequestGeneration = 0;
    let accountUsageEventIds = new Set<string>();
    let authSuccessTimer: ReturnType<typeof setTimeout> | undefined;

    onCleanup(() => {
      if (authSuccessTimer !== undefined) clearTimeout(authSuccessTimer);
    });

    function applyCentralAuthState(state: CentralAuthState): void {
      const completedCodeChallenge = centralAuth().status === "code_sent" && state.status === "signed_in";
      if (state.status !== "signed_in") {
        if (authSuccessTimer !== undefined) clearTimeout(authSuccessTimer);
        authSuccessTimer = undefined;
        setAuthSuccessVisible(false);
      } else if (completedCodeChallenge) {
        if (authSuccessTimer !== undefined) clearTimeout(authSuccessTimer);
        setAuthSuccessVisible(true);
        authSuccessTimer = setTimeout(() => {
          authSuccessTimer = undefined;
          setAuthSuccessVisible(false);
        }, AUTH_SUCCESS_HOLD_MS);
      }
      setCentralAuth(state);
    }

    onSettled(() => {
      const unsubscribe = accountPort().auth.onEvent((state) => {
        flush(() => applyCentralAuthState(state));
      });
      void accountPort()
        .auth.getState()
        .then(setCentralAuth)
        .catch(() =>
          setCentralAuth({
            status: "error",
            issue: {
              code: "auth_unavailable",
              message: currentText().t("account.login.loadFailed"),
            },
          }),
        );
      return unsubscribe;
    });

    async function requestEmailCode(email: string): Promise<void> {
      const state = await accountPort().auth.requestEmailCode(email);
      applyCentralAuthState(state);
    }

    async function retryCentralAccount(): Promise<void> {
      applyCentralAuthState({ status: "loading" });
      applyCentralAuthState(await accountPort().auth.retry());
    }

    async function verifyEmailCode(challengeId: string, code: string, referralCode?: string): Promise<void> {
      const state = await accountPort().auth.verifyEmailCode({
        challengeId,
        code,
        ...(referralCode ? { referralCode } : {}),
      });
      applyCentralAuthState(state);
    }

    async function logoutCentralAccount(): Promise<void> {
      const state = await accountPort().auth.logout();
      applyCentralAuthState(state);
    }

    async function updateAccountAvatar(image: AvatarImageInput | null): Promise<void> {
      applyCentralAuthState(await accountPort().auth.updateAvatar(image));
    }

    async function updateAccountName(name: string): Promise<void> {
      applyCentralAuthState(await accountPort().auth.updateName(name));
    }

    async function setChatColor(color: AvatarColor | null): Promise<void> {
      applyCentralAuthState(await accountPort().auth.updateChatColor(color));
    }

    const accountUsage = () => accountUsageState.data;
    const accountUsageRefreshRevision = () => accountUsageState.refreshRevision;
    const accountUsageTargetKey = () => accountUsageState.targetKey;

    function selectAccountUsageTarget(targetKey: string | null): void {
      if (accountUsageState.targetKey === targetKey) return;
      accountUsageRequestGeneration += 1;
      setAccountUsageState((state) => {
        state.targetKey = targetKey;
      });
    }

    function invalidateAccountUsage(): void {
      accountUsageRequestGeneration += 1;
      setAccountUsageState((state) => {
        state.data = null;
        state.refreshRevision += 1;
      });
    }

    function applyAccountUsage(usage: AccountUsage): void {
      if (usage.limits.length === 0) {
        accountUsageRequestGeneration += 1;
        setAccountUsageState((state) => {
          state.data = usage;
        });
        return;
      }
      for (const limit of usage.limits) accountUsageEventIds.add(usageLimitKey(limit));
      setAccountUsageState((state) => {
        const byId = new Map((state.data?.limits ?? []).map((limit) => [usageLimitKey(limit), limit]));
        for (const limit of usage.limits) {
          const key = usageLimitKey(limit);
          byId.set(key, keepUsageCredits(byId.get(key), limit));
        }
        state.data = { limits: [...byId.values()] };
      });
    }

    async function refreshAccountUsage(targetKey: string): Promise<AccountUsage> {
      selectAccountUsageTarget(targetKey);
      const generation = ++accountUsageRequestGeneration;
      accountUsageEventIds = new Set();
      const usage = await accountPort().agent.getUsage();
      if (generation === accountUsageRequestGeneration && accountUsageState.targetKey === targetKey) {
        setAccountUsageState((state) => {
          const byId = new Map(usage.limits.map((limit) => [usageLimitKey(limit), limit]));
          for (const limit of state.data?.limits ?? []) {
            const key = usageLimitKey(limit);
            if (accountUsageEventIds.has(key)) byId.set(key, withReadCredits(byId.get(key), limit));
          }
          state.data = { limits: [...byId.values()] };
        });
      }
      return usage;
    }

    function createMobileConnect() {
      return accountPort().auth.createMobileConnect();
    }

    function listMobileConnectedDevices() {
      return accountPort().auth.listMobileConnectedDevices();
    }

    function revokeMobileConnectedDevice(sessionId: string) {
      return accountPort().auth.revokeMobileConnectedDevice(sessionId);
    }

    const signedInAccount = createMemo(() => {
      const state = centralAuth();
      return state.status === "signed_in" ? state.user : null;
    });
    const visibleSignedInAccount = createMemo(() => (authSuccessVisible() ? null : signedInAccount()));

    return {
      centralAuth,
      signedInAccount,
      visibleSignedInAccount,
      accountUsage,
      accountUsageRefreshRevision,
      accountUsageTargetKey,
      selectAccountUsageTarget,
      invalidateAccountUsage,
      applyAccountUsage,
      refreshAccountUsage,
      requestEmailCode,
      retryCentralAccount,
      verifyEmailCode,
      logoutCentralAccount,
      updateAccountName,
      updateAccountAvatar,
      setChatColor,
      createMobileConnect,
      cancelMobileConnect: () => accountPort().auth.cancelMobileConnect(),
      getMobileConnectLink: () => accountPort().auth.getMobileConnectLink(),
      createMobileConnectLink: () => accountPort().auth.createMobileConnectLink(),
      revokeMobileConnectLink: () => accountPort().auth.revokeMobileConnectLink(),
      listMobileConnectedDevices,
      revokeMobileConnectedDevice,
      listAccountSessions: () => accountPort().auth.listAccountSessions(),
      revokeAccountSession: (sessionId: string) => accountPort().auth.revokeAccountSession(sessionId),
    };
  },
});

export const AuthProvider = Auth.provider;
export const useAuth = Auth.use;

function usageLimitKey(limit: AccountUsageLimit): string {
  return `${limit.id}\n${limit.accountId ?? ""}`;
}
