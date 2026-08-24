import type { AiConnectionSnapshot } from "./connection-state";

export type NativeAssistantEvent =
  | ({ type: "status" } & Partial<AiConnectionSnapshot>)
  | { type: "text-delta"; text: string; conversationId?: string }
  | { type: "final-text"; text: string; conversationId?: string }
  | { type: "tool-call"; callId: string; tool: string; arguments: unknown; conversationId?: string }
  | { type: "turn-completed"; conversationId?: string }
  | { type: "error"; message: string; conversationId?: string };

type NativeWindow = Window & {
  __TEXTTEXT_APP__?: boolean;
  __TEXTTEXT_EMBEDDED_AGENT__?: boolean;
  webkit?: {
    messageHandlers?: {
      textTextApp?: { postMessage: (message: unknown) => void };
    };
  };
};

export type NativeAssistantHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function boundedHistory(
  history: readonly NativeAssistantHistoryMessage[],
): NativeAssistantHistoryMessage[] {
  return history
    .slice(-20)
    .reduceRight<NativeAssistantHistoryMessage[]>((bounded, message) => {
      if (message.role !== "user" && message.role !== "assistant") return bounded;
      const content = message.content.trim().slice(0, 8_000);
      if (!content) return bounded;
      const used = bounded.reduce((total, entry) => total + entry.content.length, 0);
      return used + content.length <= 32_000
        ? [{ role: message.role, content }, ...bounded]
        : bounded;
    }, []);
}

export function nativeAssistantAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const current = window as NativeWindow;
  return current.__TEXTTEXT_APP__ === true && Boolean(current.webkit?.messageHandlers?.textTextApp);
}

export function nativeEmbeddedAssistantAvailable(): boolean {
  if (!nativeAssistantAvailable()) return false;
  const current = window as NativeWindow;
  return current.__TEXTTEXT_EMBEDDED_AGENT__ !== false;
}

export function requestNativeAssistant(
  action:
    | "assistantStatus"
    | "assistantConnect"
    | "assistantDisconnect"
    | "assistantCancel"
    | "assistantTurn",
  prompt?: string,
  conversationId?: string,
  history: readonly NativeAssistantHistoryMessage[] = [],
) {
  if (typeof window === "undefined") return false;
  const current = window as NativeWindow;
  const handler = current.webkit?.messageHandlers?.textTextApp;
  if (!current.__TEXTTEXT_APP__ || !handler) return false;
  handler.postMessage({
    action,
    ...(prompt === undefined ? {} : { prompt }),
    ...(conversationId ? { conversationId } : {}),
    ...(action === "assistantTurn" && history.length > 0
      ? { history: boundedHistory(history) }
      : {}),
  });
  return true;
}

export function submitNativeAssistantTurn(
  prompt: string,
  conversationId: string,
  history: readonly NativeAssistantHistoryMessage[] = [],
): boolean {
  return requestNativeAssistant("assistantTurn", prompt, conversationId, history);
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
