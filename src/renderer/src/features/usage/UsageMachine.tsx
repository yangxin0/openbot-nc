import type { MachineMetrics, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { MACHINE_RESOURCES_CAPABILITY } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { UsageMachineMeter } from "@openbot/ui/features/usage/UsageMachineMeter";
import { createMemo, createSignal, Show, untrack } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { canManageStorage } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";

const MACHINE_REFRESH_MS = 5_000;
const MACHINE_REFRESH_CHECK_MS = 1_000;

type MachinePort = Pick<OpenBotDesktopApi["storage"], "getMachineMetrics" | "getDisk">;

function machinePort(): MachinePort {
  return window.openbot.storage;
}

export function UsageMachine(props: { serverId: string }) {
  const { servers } = useServers();
  const { openServerSettings } = useServerSettings();
  const server = createMemo(() => servers().find((candidate) => candidate.id === props.serverId));
  const target = createMemo(() => {
    const current = server();
    return current && serverSupportsCapability(current, MACHINE_RESOURCES_CAPABILITY) && canManageStorage(current)
      ? current.id
      : null;
  });
  const [reading, setReading] = createSignal<{ serverId: string; metrics: MachineMetrics } | null>(null);
  let pending: string | null = null;

  function refresh(serverId: string): void {
    if (pending === serverId) return;
    pending = serverId;
    machinePort()
      .getMachineMetrics(serverId)
      .finally(() => {
        if (pending === serverId) pending = null;
      })
      .then(
        (metrics) => {
          if (untrack(target) === serverId) setReading(metrics ? { serverId, metrics } : null);
        },
        () => {
          if (untrack(target) === serverId) setReading(null);
        },
      );
  }
  createUsageRefreshPoll({
    target,
    refresh,
    refreshAtStart: true,
    refreshMs: MACHINE_REFRESH_MS,
    checkMs: MACHINE_REFRESH_CHECK_MS,
  });

  const shown = () => {
    const current = reading();
    return current && current.serverId === target() ? current : null;
  };

  return (
    <Show when={shown()}>
      {(current) => (
        <UsageMachineMeter
          metrics={current().metrics}
          onOpenStorage={() => openServerSettings(current().serverId, null, "storage")}
        />
      )}
    </Show>
  );
}
