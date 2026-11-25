import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
import { config as configureSchemas } from "zod";
import "./web-client.css";
import { loadSavedLanguage, WebApp } from "./WebApp";
import { showSavedAppearance } from "./web-appearance-preference";
import { markSoftwareRendering } from "./web-software-rendering";

const root = document.getElementById("root");

configureSchemas({ jitless: true });

if (root) {
  installPointerFocusGuard();
  showSavedAppearance();
  markSoftwareRendering();
  void loadSavedLanguage()
    .catch(() => undefined)
    .then(() => render(() => <WebApp />, root));
}
