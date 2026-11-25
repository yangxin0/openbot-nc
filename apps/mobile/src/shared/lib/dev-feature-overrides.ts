const DEV_REPLAY_ONBOARDING = false;

export function devReplayOnboarding(): boolean {
  return __DEV__ && DEV_REPLAY_ONBOARDING;
}
