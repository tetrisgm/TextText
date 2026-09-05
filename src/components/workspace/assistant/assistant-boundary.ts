"use client";

import { scheduleAfterLoadIdle } from "@/lib/after-load-idle";

export type AssistantBoundaryModules = {
  conversation: typeof import("./AssistantConversation");
  conversationState: typeof import("./AssistantConversationState");
  controller: typeof import("./useNativeAssistant");
  sidebar: typeof import("./AssistantSidebar");
};

let modules: AssistantBoundaryModules | null = null;
let pending: Promise<AssistantBoundaryModules> | null = null;
const listeners = new Set<() => void>();

export function assistantBoundarySnapshot(): AssistantBoundaryModules | null {
  return modules;
}

export function subscribeAssistantBoundary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadAssistantBoundary(): Promise<AssistantBoundaryModules> {
  if (modules) return Promise.resolve(modules);
  if (pending) return pending;

  pending = Promise.all([
    import("./AssistantConversation"),
    import("./AssistantConversationState"),
    import("./useNativeAssistant"),
    import("./AssistantSidebar"),
  ]).then(([conversation, conversationState, controller, sidebar]) => {
    modules = { conversation, conversationState, controller, sidebar };
    pending = null;
    for (const listener of listeners) listener();
    return modules;
  });
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

export function scheduleAssistantBoundaryLoad(): () => void {
  if (modules || pending || typeof window === "undefined") return () => {};
  // After the cold path, never during it; see scheduleAfterLoadIdle. Opening
  // the assistant earlier still loads it on demand through the facade queue.
  return scheduleAfterLoadIdle(() => void loadAssistantBoundary());
}
