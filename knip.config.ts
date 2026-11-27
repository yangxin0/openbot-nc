import type { KnipConfig } from "knip";

const CSS_IMPORT = /@import\s+["']([^"']+)["']/g;

function compileCss(text: string): string {
  return [...text.matchAll(CSS_IMPORT)].map(([, specifier]) => `import "${specifier}";`).join("\n");
}

const config: KnipConfig = {
  compilers: { css: compileCss },
  ignoreIssues: {
    "packages/contracts/src/team-protocol/v*.ts": ["exports", "types"],
    "packages/contracts/src/team-protocol/*-v*.ts": ["exports", "types"],
    "packages/contracts/src/team-protocol/provider-aware-codec.ts": ["exports", "types"],
    "src/backend/migrations/[0-9]*.ts": ["exports"],
  },
  ignoreBinaries: [
    "xterm",
    "openssl",
    "ccache",
    "otool",
    "install_name_tool",
    "taskkill.exe",
    "tasklist",
    "sqlite3",
    "ditto",
    "say",
    "pgrep",
    "screencapture",
    "osascript",
    "mkfifo",
    "browser-harness",
    "vm_stat",
    "dbus-run-session",
    "xcode-select",
    "sips",
    "iconutil",
    "Xvfb",
    "xdpyinfo",
    "openbox",
    "wmctrl",
    "picom",
    "ffmpeg",
    "gdbus",
    "import",
    "serve",
  ],
  workspaces: {
    ".": {
      entry: ["scripts/**/*.ts", "tools/**/*.ts", "src/renderer/stories/prototype-support.tsx"],
      project: ["src/**/*.{ts,tsx,css}", "scripts/**/*.ts", "tools/**/*.ts"],
      ignoreDependencies: [
        "@speed-highlight/core",
        "class-variance-authority",
        "marked",
        "solid-recharts",
        "solid-sonner",
        "expo",
        "@noble/hashes",
        "@cacheable/node-cache",
        "@noble/curves",
        "async-mutex",
        "long",
        "lru-cache",
        "music-metadata",
        "p-queue",
        "pino",
        "protobufjs",
      ],
      ignoreUnresolved: ["scripts/.+\\.ts"],
    },
    "apps/mobile": {
      entry: ["src/app/**/*.{ts,tsx}", "plugins/**/*.{js,ts}", "src/shims/*.{ts,js}", "global.css"],
      project: ["src/**/*.{ts,tsx}", "plugins/**/*.{js,ts}"],
      ignoreDependencies: ["openbot-original-react-native", "@expo/config-plugins", "expo-device-hub", "@expo/plist"],
    },
    "remote/api": {
      project: ["src/**/*.ts"],
    },
    "packages/i18n": {
      entry: ["src/lazy-catalogs.ts", "src/mobile-catalogs.native.ts"],
      project: ["src/**/*.{ts,tsx,css}"],
    },
    "packages/whatsapp": {
      entry: ["src/*.ts", "scripts/*.ts"],
      project: ["src/**/*.ts", "scripts/*.ts"],
      ignoreDependencies: [
        "@cacheable/node-cache",
        "@hapi/boom",
        "async-mutex",
        "long",
        "lru-cache",
        "music-metadata",
        "p-queue",
        "pino",
        "protobufjs",
        "ws",
        "@types/ws",
      ],
    },
    "packages/*": {
      project: ["src/**/*.{ts,tsx,css}"],
    },
  },
};

export default config;
