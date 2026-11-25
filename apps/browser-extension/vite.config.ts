import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import rootPackage from "../../package.json" with { type: "json" };
import { lazyLanguageCatalogs } from "../../packages/i18n/src/vite-plugin";

function extensionManifest(development: boolean): Plugin {
  return {
    name: "openbot-extension-manifest",
    generateBundle() {
      const manifest = {
        manifest_version: 3,
        name: development ? "OpenBot-NC (Dev)" : "OpenBot-NC",
        description: "Chat with your team's agents beside any page.",
        version: rootPackage.version,
        icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
        action: { default_title: "OpenBot-NC", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
        side_panel: { default_path: "sidepanel.html" },
        background: { service_worker: "background.js", type: "module" },
        permissions: [
          "sidePanel",
          "storage",
          "offscreen",
          "notifications",
          "tabs",
          "tabGroups",
          "debugger",
          "downloads",
        ],
      };
      this.emitFile({ type: "asset", fileName: "manifest.json", source: `${JSON.stringify(manifest, null, 2)}\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const development = mode === "development";
  return {
    base: "./",
    resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      minify: !development,
      sourcemap: development,
      rolldownOptions: {
        input: {
          sidepanel: "sidepanel.html",
          microphone: "microphone.html",
          offscreen: "offscreen.html",
          background: "src/background.ts",
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        },
      },
    },
    plugins: [lazyLanguageCatalogs(), tailwindcss(), solidPlugin(), extensionManifest(development)],
  };
});
