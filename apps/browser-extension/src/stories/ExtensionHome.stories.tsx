import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { HomeScreen } from "../HomeScreen";
import type { Workspace } from "../workspace";
import { WithWorkspace } from "./story-frame";
import { STORY_CHANNEL, type StoryServerOptions } from "./story-server";

const meta = {
  title: "Extension/Home",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const HOSTS: RemoteTeamHost[] = [host("host-home", "Home server"), host("host-studio", "Studio VPS")];

function host(hostId: string, name: string): RemoteTeamHost {
  return {
    hostId,
    name,
    logoKey: null,
    devicePublicKey: "story-key",
    membershipId: `membership-${hostId}`,
    role: "owner",
  };
}

function Home(props: { options?: StoryServerOptions; offline?: boolean; setup?: (workspace: Workspace) => void }) {
  return (
    <WithWorkspace options={props.options} setup={props.setup}>
      {(workspace) => (
        <HomeScreen
          workspace={workspace}
          serverName="Home server"
          hosts={HOSTS}
          hostId="host-home"
          offline={props.offline ?? false}
          onOpenAgent={() => undefined}
          onOpenChannel={() => undefined}
          onCreate={() => undefined}
          onStartThread={() => undefined}
          onSelectHost={() => undefined}
          onOpenSettings={() => undefined}
          sharing={false}
          canShare
        />
      )}
    </WithWorkspace>
  );
}

export const Chats: Story = { render: () => <Home options={{ unread: { "x-desk": 3, research: 1 } }} /> };

export const Pinned: Story = {
  render: () => (
    <Home
      options={{
        folders: true,
        channels: [STORY_CHANNEL],
        unread: { research: 3 },
        pins: [
          { kind: "agent", id: "chief" },
          { kind: "channel", id: STORY_CHANNEL.id },
          { kind: "agent", id: "research" },
        ],
      }}
    />
  ),
};

export const FoldersAndChannels: Story = {
  render: () => <Home options={{ folders: true, channels: [STORY_CHANNEL], unread: { chief: 2 } }} />,
};

export const ChannelWorking: Story = {
  render: () => <Home options={{ channels: [{ ...STORY_CHANNEL, activeTasks: 2, unreadCount: 0 }] }} />,
};

export const NoAgents: Story = { render: () => <Home options={{ agents: [] }} /> };

export const Offline: Story = { render: () => <Home offline /> };
