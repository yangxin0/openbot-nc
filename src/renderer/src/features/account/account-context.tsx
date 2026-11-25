import {
  type AccountUsage,
  type AccountUsageLimit,
  type AvatarColor,
  type CentralAuthUser,
  keepUsageCredits,
  type UserProfile,
  withReadCredits,
} from "@openbot/contracts/ipc";
import { createSignal, createStore, flush, onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { accountPort } from "./account-port";

export function profileAccount(profile: UserProfile): CentralAuthUser {
  return { id: profile.id, email: "", name: profile.name, avatarUrl: null, chatColor: profile.chatColor };
}

const Auth = createSimpleContext({
  name: "Auth",
  init: () => {
    const [profile, setProfile] = createSignal<UserProfile | null>(null);
    const [accountUsageState, setAccountUsageState] = createStore<{
      targetKey: string | null;
      data: AccountUsage | null;
      refreshRevision: number;
    }>({ targetKey: null, data: null, refreshRevision: 0 });
    let accountUsageRequestGeneration = 0;
    let accountUsageEventIds = new Set<string>();

    onSettled(() => {
      const unsubscribe = accountPort().profile.onChanged((next) => {
        flush(() => setProfile(next));
      });
      void accountPort().profile.get().then(setProfile);
      return unsubscribe;
    });

    async function updateProfileName(name: string): Promise<void> {
      setProfile(await accountPort().profile.updateName(name));
    }

    async function setChatColor(color: AvatarColor | null): Promise<void> {
      setProfile(await accountPort().profile.updateChatColor(color));
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

    return {
      profile,
      accountUsage,
      accountUsageRefreshRevision,
      accountUsageTargetKey,
      selectAccountUsageTarget,
      invalidateAccountUsage,
      applyAccountUsage,
      refreshAccountUsage,
      updateProfileName,
      setChatColor,
    };
  },
});

export const AuthProvider = Auth.provider;
export const useAuth = Auth.use;

function usageLimitKey(limit: AccountUsageLimit): string {
  return `${limit.id}\n${limit.accountId ?? ""}`;
}
