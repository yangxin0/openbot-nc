import { useMobileSession } from "@/features/auth/context/mobile-session-context";

export function useBrowserFeature(): boolean {
  return useMobileSession().session !== null;
}
