import { createEffect, createRoot, createSignal, getOwner, runWithOwner } from "solid-js";
import type { createVoiceConversation } from "./voice-conversation-store";

type VoiceConversation = ReturnType<typeof createVoiceConversation>;

interface VoiceSession {
  readonly agentId: string;
  readonly conversation: VoiceConversation;
  readonly dispose: () => void;
}

export function createVoiceSessions() {
  const owner = getOwner();
  let session: VoiceSession | undefined;
  const [activeAgentId, setActiveAgentId] = createSignal<string | null>(null);

  function end(ended: VoiceSession | undefined = session): void {
    if (!ended || ended !== session) return;
    session = undefined;
    ended.dispose();
  }

  return {
    active(agentId: string): boolean {
      return activeAgentId() === agentId;
    },
    start(agentId: string): void {
      if (activeAgentId() === agentId) return;
      if (session?.agentId !== agentId) end();
      setActiveAgentId(agentId);
    },
    stop(agentId: string): void {
      if (activeAgentId() !== agentId) return;
      setActiveAgentId(null);
      if (session?.agentId === agentId) end();
    },
    open(agentId: string, create: () => VoiceConversation): VoiceConversation {
      if (session?.agentId === agentId) return session.conversation;
      end();
      const next = runWithOwner(owner, () =>
        createRoot((dispose): VoiceSession => {
          const opened: VoiceSession = { agentId, conversation: create(), dispose };
          createEffect(
            () => activeAgentId() === agentId,
            (on) => {
              if (!on) queueMicrotask(() => end(opened));
            },
          );
          return opened;
        }),
      );
      session = next;
      return next.conversation;
    },
    end(): void {
      end();
    },
  };
}
