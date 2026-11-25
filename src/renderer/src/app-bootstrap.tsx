import { flush, onSettled } from "solid-js";
import { appPort } from "./app-port";
import { useSettings } from "./features/settings/settings-context";

export function AppBootstrap() {
  const { setPendingPluginSlug, setSkillsMarketplaceOpen } = useSettings();

  onSettled(() => {
    const receivePluginSlug = (slug: string) => {
      flush(() => {
        setPendingPluginSlug(slug);
        setSkillsMarketplaceOpen(true);
      });
    };
    const unsubscribePlugin = appPort().plugins.onOpenListing((slug) => {
      receivePluginSlug(slug);
    });
    void appPort()
      .plugins.takePendingListing()
      .then((slug) => slug && receivePluginSlug(slug))
      .catch(() => undefined);
    return unsubscribePlugin;
  });

  return null;
}
