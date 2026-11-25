import * as Network from "expo-network";
import { AppState } from "react-native";
import { type PhoneConnection, phoneNetworkText } from "./phone-network";
import { supportLog } from "./support-log";

const NOT_READ = "Not read yet";

let text = NOT_READ;
let reading: Promise<string> | null = null;
let again = false;
let installed = false;

function connectionOf(state: Network.NetworkState): PhoneConnection {
  if (state.isConnected === false || state.type === Network.NetworkStateType.NONE) return "none";
  if (state.type === Network.NetworkStateType.WIFI) return "wifi";
  if (state.type === Network.NetworkStateType.CELLULAR) return "cellular";
  if (state.type === Network.NetworkStateType.ETHERNET) return "ethernet";
  if (state.type === Network.NetworkStateType.VPN) return "vpn";
  return "unknown";
}

async function read(): Promise<string> {
  const state = await Network.getNetworkStateAsync().catch((): Network.NetworkState => ({}));
  return phoneNetworkText({ connection: connectionOf(state), addresses: null });
}

function refreshPhoneNetwork(): Promise<string> {
  if (reading) {
    again = true;
    return reading;
  }
  const current = (async () => {
    let next = text;
    do {
      again = false;
      const result = await read().catch(() => null);
      if (result) next = result;
    } while (again);
    if (next !== text) {
      text = next;
      supportLog.add("info", "app", `Network: ${next}`);
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

export function installPhoneNetwork(): void {
  if (installed) return;
  installed = true;
  Network.addNetworkStateListener(() => void refreshPhoneNetwork());
  AppState.addEventListener("change", (state) => {
    if (state === "active") void refreshPhoneNetwork();
  });
  requestIdleCallback(() => void refreshPhoneNetwork());
}
