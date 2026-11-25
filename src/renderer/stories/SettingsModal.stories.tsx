import type { CentralAuthUser, ServerSummary, UpdateStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Button, Toaster, toast } from "@openbot/ui";
import { DEFAULT_GENERAL_SETTINGS, type GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { RelayProvider } from "../src/features/relay/relay-context";
import { SettingsModal } from "../src/features/settings/SettingsModal";
import type { SettingsTab } from "../src/features/settings/settings-tabs";
import { LayoutProvider } from "../src/layout";
import { PlatformProvider } from "../src/platform";
import { STORY_AGENTS, STORY_SERVERS } from "../src/preview/fixtures";
import type { MockRelayScenario } from "../src/preview/mock-relay";
import type { MockVoiceOptions } from "../src/preview/mock-voice";
import { createMockOpenBot } from "./mock-openbot";
import { SettingsPageStory } from "./settings-page-story";
import { previewStorySoundSettings } from "./sound-feedback-fixture";

const storyGeneralSettings: GeneralSettingsValue = {
  ...DEFAULT_GENERAL_SETTINGS,
  launchAtLogin: true,
  keepRunningInBackground: false,
  keepAwake: false,
  keepAwakeOnBattery: false,
  quitGuard: "working",
};

const storyAppInfo = { name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" } as const;
const storyAccount: CentralAuthUser = {
  id: "user-1",
  email: "person@example.com",
  name: "Norbert",
  avatarUrl: null,
};
const storyUpdateStatus: UpdateStatus = {
  phase: "idle",
  currentVersion: "0.2.1",
  availableVersion: null,
  progress: null,
  checkedAt: null,
  message: null,
  errorCode: null,
};

function storyInitialUpdateStatus(props: {
  scheduledRestart?: UpdateStatus["scheduledRestart"];
  stagedVersion?: string;
  notInstalled?: boolean;
}): UpdateStatus {
  if (props.notInstalled)
    return {
      ...storyUpdateStatus,
      phase: "ready",
      availableVersion: "0.3.0",
      progress: 100,
      message: sourceText("error.update.notInstalled"),
    };
  if (props.scheduledRestart)
    return {
      ...storyUpdateStatus,
      phase: "ready",
      availableVersion: "0.3.0",
      scheduledRestart: props.scheduledRestart,
    };
  if (props.stagedVersion)
    return {
      ...storyUpdateStatus,
      phase: "up-to-date",
      checkedAt: new Date().toISOString(),
      stagedVersion: props.stagedVersion,
    };
  return storyUpdateStatus;
}

const storyAgentDock = {
  server: { id: STORY_SERVERS[0].id, name: STORY_SERVERS[0].name },
  agents: STORY_AGENTS,
  hiddenAgentIds: new Set<string>(),
};

function SettingsModalStory(props: {
  initialOpen: boolean;
  initialTab?: SettingsTab;
  openTab?: SettingsTab;
  scheduledRestart?: UpdateStatus["scheduledRestart"];
  stagedVersion?: string;
  notInstalled?: boolean;
  voice?: MockVoiceOptions;
  agentDock?: boolean;
  relay?: MockRelayScenario;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({ ...props.voice, relay: props.relay ?? "none" });
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    toast.dismiss();
    if (window.openbot === mock.api) window.openbot = previousApi;
  });
  const [open, setOpen] = createSignal(props.initialOpen);
  const [value, setValue] = createSignal({ ...storyGeneralSettings });
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>(storyInitialUpdateStatus(props));
  const [account, setAccount] = createSignal<CentralAuthUser>({ ...storyAccount });
  const [servers, setServers] = createSignal<readonly ServerSummary[]>(STORY_SERVERS);
  const updateServer = (serverId: string, change: Partial<ServerSummary>): void => {
    setServers((list) => list.map((server) => (server.id === serverId ? { ...server, ...change } : server)));
  };
  async function updateAccountName(name: string): Promise<void> {
    setAccount((current) => ({ ...current, name }));
  }

  async function runUpdateAction(): Promise<void> {
    const checkedAt = new Date().toISOString();
    setUpdateStatus(
      props.stagedVersion
        ? { ...storyUpdateStatus, phase: "available", availableVersion: props.stagedVersion, checkedAt }
        : { ...storyUpdateStatus, phase: "up-to-date", checkedAt },
    );
  }

  return (
    <PlatformProvider>
      <RelayProvider>
        <LayoutProvider>
          <SettingsPageStory
            title="Settings"
            controls={
              <Button variant="outline" type="button" onClick={() => setOpen(true)}>
                Open settings
              </Button>
            }
            onEscape={() => setOpen(false)}
          >
            {(page) => (
              <SettingsModal
                page={page()}
                initialTab={props.initialTab}
                openTab={props.openTab}
                open={open()}
                value={value()}
                onValueChange={(next) => {
                  previewStorySoundSettings(value(), next);
                  setValue(next);
                }}
                appInfo={storyAppInfo}
                servers={servers()}
                onSetServerNotificationLevel={async (serverId, level) =>
                  updateServer(serverId, { notificationLevel: level })
                }
                onSetServerMuted={async (serverId, muted, durationMs) =>
                  updateServer(serverId, {
                    notificationsMuted: muted,
                    notificationsMutedUntil: muted && durationMs !== undefined ? Date.now() + durationMs : null,
                  })
                }
                updateStatus={updateStatus()}
                onCancelScheduledRestart={async () => {
                  const { scheduledRestart: _cancelled, ...rest } = updateStatus();
                  setUpdateStatus(rest);
                }}
                account={account()}
                onUpdateAccountName={updateAccountName}
                onSetChatColor={async (chatColor) => {
                  setAccount((current) => ({ ...current, chatColor }));
                }}
                onUpdateAction={runUpdateAction}
                agentDock={props.agentDock ? storyAgentDock : undefined}
              />
            )}
          </SettingsPageStory>
        </LayoutProvider>
      </RelayProvider>
      <Toaster />
    </PlatformProvider>
  );
}

const meta = {
  title: "Settings/SettingsModal",
  component: SettingsModal,
  args: {
    open: false,
    value: storyGeneralSettings,
    onValueChange: fn(),
    appInfo: storyAppInfo,
    updateStatus: storyUpdateStatus,
    onUpdateAction: fn(async () => undefined),
    account: storyAccount,
    onUpdateAccountName: fn(async () => undefined),
    onSetChatColor: fn(async () => undefined),
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        settingsDesktop: {
          name: "Settings — 1200 × 820",
          styles: { width: "1200px", height: "820px" },
        },
        settingsNarrow: {
          name: "Settings — 640 × 720",
          styles: { width: "640px", height: "720px" },
        },
        settingsPhone: {
          name: "Settings — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
} satisfies Meta<typeof SettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: () => <SettingsModalStory initialOpen />,
};

export const Narrow: Story = {
  render: () => <SettingsModalStory initialOpen />,
  parameters: { viewport: { defaultViewport: "settingsNarrow" } },
};

export const Profile: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="profile" />,
};

export const Notifications: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="notifications" />,
};

export const Voice: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="voice" />,
};

export const Keyboard: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="keyboard" />,
};

export const VoiceWhisperHungarian: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      initialTab="voice"
      voice={{
        voiceModelsReady: ["parakeet-tdt-0.6b-v3", "whisper-turbo"],
        voiceSettings: { modelId: "whisper-turbo", language: "hu" },
      }}
    />
  ),
};

export const VoiceCohereLanguages: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      initialTab="voice"
      voice={{
        voiceModelsReady: ["parakeet-tdt-0.6b-v3", "cohere-transcribe-03-2026"],
        voiceSettings: { modelId: "cohere-transcribe-03-2026", language: "hu" },
      }}
    />
  ),
};

export const VoiceRetiredBarkInUse: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      initialTab="voice"
      voice={{
        voiceModelsReady: ["parakeet-tdt-0.6b-v3", "bark-3.0-plus"],
        voiceSettings: { modelId: "bark-3.0-plus", language: "automatic" },
      }}
    />
  ),
};

export const VoiceModelsDownloaded: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      initialTab="voice"
      voice={{ voiceModelsReady: ["parakeet-tdt-0.6b-v3", "parakeet-unified-en-0.6b"], speechModelReady: true }}
    />
  ),
};

export const TeamNoIdentity: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="team" relay="none" />,
};

export const TeamOnline: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="team" relay="online" />,
};

export const TeamOffline: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="team" relay="offline" />,
};

export const TeamExpiringSoon: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="team" relay="expiring" />,
};

export const TeamHosting: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="team" relay="hosting" />,
};

export const AgentDock: Story = {
  render: () => <SettingsModalStory initialOpen agentDock initialTab="agent-dock" />,
};

export const ScheduledRemoteUpdate: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      initialTab="updates"
      scheduledRestart={{ requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: ["agent-turn"] }}
    />
  ),
};

export const StagedRollout: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="updates" stagedVersion="0.3.0" />,
};

export const UpdateNotInstalled: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="updates" notInstalled />,
};

export const Interactive: Story = {
  render: () => <SettingsModalStory initialOpen={false} />,
};
