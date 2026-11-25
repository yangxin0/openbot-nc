import type { AppTranslate } from "@openbot/i18n";
import { Menu, type NativeImage, Tray } from "electron";

export interface BackgroundTray {
  sync: (keepRunningInBackground: boolean) => void;
  relabel: () => void;
  setIcon: (icon: NativeImage) => void;
  setHiddenWhileWorking: (hidden: boolean) => void;
  destroy: () => void;
}

export function createBackgroundTray(options: {
  icon: NativeImage;
  menuBarIcon: NativeImage | null;
  translate: AppTranslate;
  open: () => void;
  quit: () => void;
}): BackgroundTray {
  let tray: Tray | null = null;
  let icon = options.icon;
  let keepRunningInBackground = false;
  let hiddenWhileWorking = false;

  function relabel(): void {
    if (!tray) return;
    tray.setToolTip(options.translate("menu.trayTooltip"));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: options.translate("menu.trayOpen"), click: options.open },
        { type: "separator" },
        { label: options.translate("menu.trayQuit"), click: options.quit },
      ]),
    );
  }

  function destroy(): void {
    tray?.destroy();
    tray = null;
  }

  function update(): void {
    if (!keepRunningInBackground && !hiddenWhileWorking) {
      destroy();
      return;
    }
    if (!tray) {
      tray = new Tray(options.menuBarIcon ?? trayIcon(icon));
      tray.on("click", options.open);
    }
    relabel();
  }

  return {
    sync: (next) => {
      keepRunningInBackground = next;
      update();
    },
    relabel,
    setIcon: (next) => {
      icon = next;
      if (!options.menuBarIcon) tray?.setImage(trayIcon(icon));
    },
    setHiddenWhileWorking: (hidden) => {
      if (hidden === hiddenWhileWorking) return;
      hiddenWhileWorking = hidden;
      update();
    },
    destroy,
  };
}

function trayIcon(source: NativeImage): NativeImage {
  const size = process.platform === "win32" ? 16 : 32;
  const icon = source.resize({ width: size, height: size, quality: "best" });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: size * 2, height: size * 2, quality: "best" }).toPNG(),
  });
  return icon;
}
