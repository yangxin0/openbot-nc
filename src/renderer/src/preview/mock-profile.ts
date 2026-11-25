import type { OpenBotDesktopApi, UserProfile } from "@openbot/contracts/ipc";
import { clone, type Listener, type MockRuntime } from "./mock-support";

export interface MockProfileOptions {
  profile?: UserProfile;
}

export function createMockProfile(options: MockProfileOptions, { emit }: MockRuntime) {
  let profile = clone<UserProfile>(options.profile ?? { id: "user-1", name: "Norbert", chatColor: null });
  const listeners = new Set<Listener<UserProfile>>();
  function update(change: Partial<Pick<UserProfile, "name" | "chatColor">>): UserProfile {
    profile = { ...profile, ...change };
    emit(listeners, profile);
    return clone(profile);
  }

  const api: OpenBotDesktopApi["profile"] = {
    get: async () => clone(profile),
    updateName: async (name) => update({ name }),
    updateChatColor: async (chatColor) => update({ chatColor }),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    profile: api,
    dispose: () => listeners.clear(),
  };
}
