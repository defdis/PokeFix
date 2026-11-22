/**
 * Tiny renderer-side bus so other components (the annotator bar plane button)
 * can push a prompt into the ACP chat panel without prop drilling or IPC.
 * The chat panel owns the only ACP session; it subscribes on mount.
 */
export type AgentChatEvent = {type: 'send'; text: string};

type Listener = (event: AgentChatEvent) => void;

const listeners = new Set<Listener>();

export const emitAgentChatSend = (text: string): void => {
  const event: AgentChatEvent = {type: 'send', text};
  listeners.forEach((listener) => listener(event));
};

export const subscribeAgentChat = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
