import type { ComputerUsePermissionApp, MacPermissionId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import type { BrowserWindow, NativeImage } from "electron";
import { causeHelpers } from "../backend/effect-boundary";
import { applicationBundleName } from "./computer-use-permission-app";

export interface PermissionHelpWindow {
  show(): void;
  close(): void;
  isDestroyed(): boolean;
  on(event: "closed", listener: () => void): unknown;
  readonly webContents: { id: number };
}

export interface PermissionAppDragSender {
  readonly id: number;
  startDrag(item: { file: string; icon: NativeImage | string }): void;
}

export interface ComputerUsePermissionHelpWindowOptions<W extends PermissionHelpWindow = BrowserWindow> {
  createWindow: () => W;
  loadWindow: (window: W, permission: MacPermissionId) => Promise<void>;
  bundlePath: () => string | null;
  bundleIcon: (path: string) => Promise<NativeImage | string>;
  revealPath: (path: string) => void;
}

export class ComputerUsePermissionHelpWindowController<W extends PermissionHelpWindow = BrowserWindow> {
  readonly #options: ComputerUsePermissionHelpWindowOptions<W>;
  #window: W | null = null;
  #generation = 0;

  constructor(options: ComputerUsePermissionHelpWindowOptions<W>) {
    this.#options = options;
  }

  get open(): boolean {
    return this.#window !== null && !this.#window.isDestroyed();
  }

  readonly show = Effect.fn("PermissionHelpWindow.show")(function* (
    this: ComputerUsePermissionHelpWindowController<W>,
    permission: MacPermissionId,
  ): Effect.fn.Return<void, PermissionHelpFailed> {
    const generation = ++this.#generation;
    const window = this.#ensureWindow();
    yield* helpCall(() => this.#options.loadWindow(window, permission));
    if (generation !== this.#generation || window.isDestroyed()) return;
    window.show();
  }).bind(this);

  readonly permissionApp = Effect.fn("PermissionHelpWindow.permissionApp")(function* (
    this: ComputerUsePermissionHelpWindowController<W>,
  ): Effect.fn.Return<ComputerUsePermissionApp | null> {
    const path = this.#options.bundlePath();
    if (!path) return null;
    const icon = yield* helpCall(() => this.#options.bundleIcon(path)).pipe(Effect.orElseSucceed(() => null));
    return {
      name: applicationBundleName(path),
      iconDataUrl: typeof icon === "string" ? icon : (icon?.toDataURL() ?? null),
    };
  }).bind(this);

  readonly startDrag = Effect.fn("PermissionHelpWindow.startDrag")(function* (
    this: ComputerUsePermissionHelpWindowController<W>,
    sender: PermissionAppDragSender,
  ): Effect.fn.Return<void, PermissionHelpFailed> {
    if (sender.id !== this.#rendererId)
      return yield* new PermissionHelpFailed({
        cause: new Error("The Computer Use drag must start in the help window."),
      });
    const generation = this.#generation;
    const path = this.#options.bundlePath();
    if (!path)
      return yield* new PermissionHelpFailed({ cause: new Error(sourceText("error.computerUse.noAppToDrag")) });
    const icon = yield* helpCall(() => this.#options.bundleIcon(path));
    if (generation !== this.#generation || sender.id !== this.#rendererId) {
      return yield* new PermissionHelpFailed({
        cause: new Error(sourceText("error.computerUse.helpWindowChanged")),
      });
    }
    sender.startDrag({ file: path, icon });
  }).bind(this);

  reveal(): void {
    const path = this.#options.bundlePath();
    if (!path) throw new Error(sourceText("error.computerUse.noAppToShow"));
    this.#options.revealPath(path);
  }

  get #rendererId(): number | null {
    return this.#window && !this.#window.isDestroyed() ? this.#window.webContents.id : null;
  }

  close(): void {
    this.#generation += 1;
    const window = this.#window;
    this.#window = null;
    if (window && !window.isDestroyed()) window.close();
  }

  #ensureWindow(): W {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const window = this.#options.createWindow();
    this.#window = window;
    window.on("closed", () => {
      if (this.#window === window) this.#window = null;
    });
    return window;
  }
}

export class PermissionHelpFailed extends Schema.TaggedError<PermissionHelpFailed>()("PermissionHelpFailed", {
  cause: Schema.Defect(),
}) {}

const { io: helpCall } = causeHelpers(PermissionHelpFailed);
