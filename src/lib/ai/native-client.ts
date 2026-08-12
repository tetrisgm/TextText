import type { AiConnectionSnapshot } from "./connection-state";

export type NativeAssistantEvent =
  | ({ type: "status" } & Partial<AiConnectionSnapshot>)
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; callId: string; tool: string; arguments: unknown }
  | { type: "error"; message: string };

type NativeWindow = Window & {
  __TEXTTEXT_APP__?: boolean;
  webkit?: {
    messageHandlers?: {
      textTextApp?: { postMessage: (message: unknown) => void };
    };
  };
};

export function nativeAssistantAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const current = window as NativeWindow;
  return current.__TEXTTEXT_APP__ === true && Boolean(current.webkit?.messageHandlers?.textTextApp);
}

export function requestNativeAssistant(
  action: "assistantStatus" | "assistantConnect" | "assistantTurn",
  prompt?: string,
) {
  if (typeof window === "undefined") return false;
  const current = window as NativeWindow;
  const handler = current.webkit?.messageHandlers?.textTextApp;
  if (!current.__TEXTTEXT_APP__ || !handler) return false;
  handler.postMessage(prompt === undefined ? { action } : { action, prompt });
  return true;
}

export function submitNativeAssistantTurn(prompt: string): boolean {
  return requestNativeAssistant("assistantTurn", prompt);
}

export function registerNativeAssistantTools(
  tools: ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): boolean {
  if (typeof window === "undefined") return false;
  const current = window as NativeWindow;
  const handler = current.webkit?.messageHandlers?.textTextApp;
  if (!current.__TEXTTEXT_APP__ || !handler) return false;
  handler.postMessage({ action: "assistantTools", tools });
  return true;
}

export function submitNativeAssistantToolResult(
  callId: string,
  output: unknown,
  isError = false,
): boolean {
  if (typeof window === "undefined") return false;
  const current = window as NativeWindow;
  const handler = current.webkit?.messageHandlers?.textTextApp;
  if (!current.__TEXTTEXT_APP__ || !handler) return false;
  handler.postMessage({ action: "assistantToolResult", callId, output, isError });
  return true;
}

export function subscribeNativeAssistant(
  listener: (event: NativeAssistantEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<NativeAssistantEvent>).detail;
    if (!detail || typeof detail !== "object" || typeof detail.type !== "string") return;
    listener(detail);
  };
  window.addEventListener("texttext:assistant", onEvent);
  return () => window.removeEventListener("texttext:assistant", onEvent);
}
