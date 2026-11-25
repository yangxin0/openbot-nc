import { Toaster } from "@openbot/ui";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";
import { nativeBrowserPageShown, nativeBrowserPageToastOffset } from "./native-browser-page";
import { WindowAmbientMotion } from "./window-ambient-motion";

export function App(props: AppProps = {}) {
  return (
    <>
      <AppProviders
        landingPreview={props.landingPreview}
        peopleEnabled={props.peopleEnabled}
        chatWindow={props.chatWindow}
      >
        <WindowAmbientMotion>
          <AppAccessGate />
        </WindowAmbientMotion>
      </AppProviders>
      <Toaster hidden={nativeBrowserPageShown()} offset={nativeBrowserPageToastOffset()} />
    </>
  );
}
