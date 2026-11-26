import { parseRelayJoinCode } from "@openbot/contracts/relay-protocol/enrollment";
import { create } from "zustand";

interface PendingJoinCodeState {
  code: string | null;
}

export const usePendingJoinCode = create<PendingJoinCodeState>(() => ({ code: null }));

export function holdPendingJoinCode(text: string): boolean {
  if (!parseRelayJoinCode(text)) return false;
  usePendingJoinCode.setState({ code: text.trim() });
  return true;
}

export function takePendingJoinCode(): string | null {
  const { code } = usePendingJoinCode.getState();
  if (code !== null) usePendingJoinCode.setState({ code: null });
  return code;
}
