import type {
  CustomProviderRestart,
  CustomProviderSummary,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import type { CustomProvidersEndpointApi } from "../custom-providers-port";

interface CustomProvidersState {
  providers: CustomProviderSummary[];
  loaded: boolean;
}

export function createCustomProvidersStore(api: () => CustomProvidersEndpointApi | undefined) {
  const [state, setState] = createStore<CustomProvidersState>({ providers: [], loaded: false });

  function apply(providers: CustomProviderSummary[]): void {
    setState((current) => {
      current.providers = providers;
      current.loaded = true;
    });
  }

  function customProviders(): CustomProviderSummary[] {
    return state.providers;
  }

  function customProvidersLoaded(): boolean {
    return state.loaded;
  }

  async function refreshCustomProviders(): Promise<void> {
    const group = api();
    if (!group) return;
    apply(await group.list());
  }

  async function saveCustomProvider(input: SaveCustomProviderInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const result = await group.save(input);
    apply(result.providers);
    return result.restart;
  }

  async function updateCustomProvider(input: UpdateCustomProviderInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const result = await group.update(input);
    apply(result.providers);
    return result.restart;
  }

  async function deleteCustomProvider(id: string): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.removeUnavailable"));
    const result = await group.delete({ id });
    apply(result.providers);
    return result.restart;
  }

  return {
    customProviders,
    customProvidersLoaded,
    refreshCustomProviders,
    saveCustomProvider,
    updateCustomProvider,
    deleteCustomProvider,
  };
}
