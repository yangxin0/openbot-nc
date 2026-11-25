import * as Network from "expo-network";
import { AppState } from "react-native";
import { type PhoneConnection, type PhoneVpnState, phoneNetworkText, phoneVpnState } from "./phone-network";
import { supportLog } from "./support-log";

const NOT_READ = "Not read yet";

let text = NOT_READ;
let vpn: PhoneVpnState = "unknown";
let reading: Promise<string> | null = null;
let again = false;
let installed = false;
const listeners = new Set<() => void>();

function connectionOf(state: Network.NetworkState): PhoneConnection {
  if (state.isConnected === false || state.type === Network.NetworkStateType.NONE) return "none";
  if (state.type === Network.NetworkStateType.WIFI) return "wifi";
  if (state.type === Network.NetworkStateType.CELLULAR) return "cellular";
  if (state.type === Network.NetworkStateType.ETHERNET) return "ethernet";
  if (state.type === Network.NetworkStateType.VPN) return "vpn";
  return "unknown";
}

async function read(): Promise<{ text: string; vpn: PhoneVpnState }> {
  const state = await Network.getNetworkStateAsync().catch((): Network.NetworkState => ({}));
  const network = { connection: connectionOf(state), addresses: null };
  return { text: phoneNetworkText(network), vpn: phoneVpnState(network) };
}

export function refreshPhoneNetwork(): Promise<string> {
  if (reading) {
    again = true;
    return reading;
  }
  const current = (async () => {
    let next = text;
    do {
      again = false;
      const result = await read().catch(() => null);
      if (result) {
        next = result.text;
        vpn = result.vpn;
      }
    } while (again);
    if (next !== text) {
      text = next;
      supportLog.add("info", "app", `Network: ${next}`);
      for (const listener of listeners) listener();
    }
    return text;
  })().finally(() => {
    reading = null;
  });
  reading = current;
  return current;
}

export function phoneNetwork(): string {
  return text;
}

export function phoneVpn(): PhoneVpnState {
  return vpn;
}

export function subscribePhoneNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installPhoneNetwork(): void {
  if (installed) return;
  installed = true;
  Network.addNetworkStateListener(() => void refreshPhoneNetwork());
  AppState.addEventListener("change", (state) => {
    if (state === "active") void refreshPhoneNetwork();
  });
  requestIdleCallback(() => void refreshPhoneNetwork());
}
