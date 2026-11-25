import type { TeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { createMemo, createSignal, flush, onSettled } from "solid-js";
import { EMPTY_TEAM_PRESENCE } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useServers } from "../servers/servers-context";
import { teamPort } from "./team-port";

const Presence = createSimpleContext({
  name: "Presence",
  init: () => {
    const { profile } = useAuth();
    const [teamPresence, setTeamPresence] = createSignal<TeamPresenceSnapshot>(EMPTY_TEAM_PRESENCE);

    const { activeServer } = useServers();
    const currentTeamMember = createMemo(() => {
      if (!profile() || activeServer()?.kind !== "local") return undefined;
      return teamPresence().members.find((member) => member.role === "owner");
    });

    const directPeople = createMemo(() => {
      const currentMemberId = currentTeamMember()?.id;
      if (!currentMemberId) return [];
      return teamPresence().members.filter((member) => member.id !== currentMemberId && !member.disabled);
    });

    const readerMemberId = createMemo((): string | null => {
      const matched = currentTeamMember()?.id;
      if (matched) return matched;
      if (!activeServer()?.thisComputer) return null;
      return teamPresence().members.find((member) => member.role === "owner")?.id ?? null;
    });

    onSettled(() => teamPort().servers.onPresence((snapshot) => flush(() => setTeamPresence(snapshot))));

    return { teamPresence, setTeamPresence, currentTeamMember, readerMemberId, directPeople };
  },
});

export const PresenceProvider = Presence.provider;
export const usePresence = Presence.use;
