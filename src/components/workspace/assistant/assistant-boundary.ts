"use client";

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

  // The cold path finishes first. An idle callback fires while the pool
  // fetch is still pending, so the assistant's chunks downloaded and parsed
  // before the list was visible and the split saved nothing. Wait for the
  // window load event and a quiet period after it; opening the assistant
  // earlier still loads it on demand through the facade queue.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idle: number | null = null;
  const load = () => void loadAssistantBoundary();
  const settle = () => {
    timer = null;
    if ("requestIdleCallback" in window) idle = window.requestIdleCallback(load);
    else load();
  };
  const arm = () => {
    timer = globalThis.setTimeout(settle, 2500);
  };
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm, { once: true });
  return () => {
    window.removeEventListener("load", arm);
    if (timer !== null) globalThis.clearTimeout(timer);
    if (idle !== null) window.cancelIdleCallback(idle);
  };
}
