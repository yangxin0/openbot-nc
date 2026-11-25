import { createHash } from "node:crypto";
import { resolve } from "node:path";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { APP_NAME } from "./packages/contracts/src/app-identity";
import { lazyLanguageCatalogs } from "./packages/i18n/src/vite-plugin";
import { WEB_APPEARANCE_BOOT_SCRIPT } from "./src/renderer/src/features/web-client/web-appearance-boot";

const WEB_CLIENT_BASE = "/app/";

export default defineConfig({
  root: resolve("src/renderer/web-client"),
  base: WEB_CLIENT_BASE,
  publicDir: false,
  define: { __OPENBOT_PERF_PROBES__: "false" },
  plugins: [
    solidPlugin({ performanceTracks: false }),
    tailwindcss({ optimize: false }),
    lazyLanguageCatalogs(),
    webClientPage(),
  ],
  optimizeDeps: {
    exclude: ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"],
  },
  resolve: {
    dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"],
  },
  build: {
    outDir: resolve(".openbot-build/web-client"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    rolldownOptions: { input: resolve("src/renderer/web-client/index.html") },
  },
});

function webClientPage(): Plugin {
  const bootScript = `${WEB_APPEARANCE_BOOT_SCRIPT}\n`;
  const bootFile = `assets/appearance-boot-${createHash("sha256").update(bootScript).digest("hex").slice(0, 12)}.js`;
  return {
    name: "openbot-web-client-page",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return {
          html: html.replaceAll("%OPENBOT_APP_NAME%", APP_NAME),
          tags: [{ tag: "script", attrs: { src: `${WEB_CLIENT_BASE}${bootFile}` }, injectTo: "head-prepend" }],
        };
      },
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: bootFile, source: bootScript });
    },
  };
}
