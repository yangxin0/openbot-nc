import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SITES_KEY } from "../client-browser-messages";
import { SettingsScreen } from "../SettingsScreen";
import { PanelFrame } from "./story-frame";
import { installStoryChrome } from "./story-server";

const meta = {
  title: "Extension/Settings",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SITES = {
  "https://news.ycombinator.com": "always",
  "https://docs.google.com": "always",
  "https://linear.app": "always",
  "https://www.a-very-long-subdomain-name.example-shop.co.uk": "always",
};

const IDENTITY = {
  team: "Acme",
  user: "alice",
  device: "extension",
  relayUrl: "wss://relay.example.com/v1/relay",
  expiresAt: Date.UTC(2027, 10, 26),
};

function Settings(props: { canShare?: boolean; sites?: boolean; connection?: "online" | "connecting" }) {
  installStoryChrome(props.sites === false ? {} : { [SITES_KEY]: SITES });
  return (
    <PanelFrame>
      <SettingsScreen
        canShare={props.canShare ?? true}
        identity={IDENTITY}
        connection={{ status: props.connection ?? "online" }}
        onBack={() => undefined}
        onRemoveIdentity={() => Promise.resolve()}
      />
    </PanelFrame>
  );
}

export const Identity: Story = { render: () => <Settings /> };

export const Connecting: Story = { render: () => <Settings connection="connecting" /> };

export const NoAllowedSites: Story = { render: () => <Settings sites={false} /> };

export const ServerWithoutSharedTabs: Story = { render: () => <Settings canShare={false} /> };
