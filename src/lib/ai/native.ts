// Typed client for the Mac app's on-device AI bridge (NativeAI.swift). The
// bridge exists only inside Texttext.app on the workspace origin; on the plain
// web these helpers report unavailable. The in-app assistant uses this bridge
// directly and does not route its requests through a cloud provider or MCP.

export type NativeAICapabilities = {
  available: boolean;
  reason?:
    | "deviceNotEligible"
    | "appleIntelligenceNotEnabled"
    | "modelNotReady"
    | "osTooOld"
    | "sdkTooOld"
    | "unavailable";
  os?: string;
  ocr: boolean;
  imageUnderstanding: boolean;
  textOps?: string[];
};

type NativeBridge = {
  request: (op: string, payload?: Record<string, unknown>) => Promise<unknown>;
};

function bridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as { writeNativeAI?: NativeBridge }).writeNativeAI;
  return candidate ?? null;
}

export function hasNativeAI(): boolean {
  return bridge() !== null;
}

export function isNativeModelAssetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /local model asset|assets unavailable/i.test(message);
}

async function request<T>(
  op: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const handle = bridge();
  if (!handle) throw new Error("Native AI bridge is not available");
  return (await handle.request(op, payload)) as T;
}

/** Availability probe; safe to call anywhere (resolves unavailable on web). */
export async function nativeAICapabilities(): Promise<NativeAICapabilities> {
  if (!bridge()) return { available: false, ocr: false, imageUnderstanding: false };
  try {
    return await request<NativeAICapabilities>("capabilities");
  } catch {
    return {
      available: false,
      reason: "unavailable",
      ocr: false,
      imageUnderstanding: false,
    };
  }
}

export function nativeGenerate(
  prompt: string,
  instructions?: string,
): Promise<{ text: string; truncated: boolean }> {
  return request("generate", { prompt, instructions });
}

export function nativeTitle(
  text: string,
): Promise<{ title: string; truncated: boolean }> {
  return request("title", { text });
}

export function nativeTags(
  text: string,
  max = 5,
): Promise<{ tags: string[]; truncated: boolean }> {
  return request("tags", { text, max });
}

export function nativeExcerpt(
  text: string,
): Promise<{ excerpt: string; truncated: boolean }> {
  return request("excerpt", { text });
}

export function nativeSummarize(
  text: string,
): Promise<{ summary: string; truncated: boolean }> {
  return request("summarize", { text });
}

export function nativeRewrite(
  text: string,
  style?: string,
): Promise<{ text: string; truncated: boolean }> {
  return request("rewrite", { text, style });
}

export function nativeCategorize(
  text: string,
  categories: string[],
): Promise<{ category: string; confident: boolean; truncated: boolean }> {
  return request("categorize", { text, categories });
}

/** OCR via Vision; works on every macOS the app runs on, not just 26+. */
export function nativeOcr(imageBase64: string): Promise<{ text: string }> {
  return request("ocr", { imageBase64 });
}

// ---- Agent: on-device tool calling over the workspace commands ----
//
// The model runs in the Mac app (NativeAI.swift) but its tools EXECUTE here,
// in the page, through the executor registered below, so the model can only
// do what the signed-in page can do. Flow: nativeAgent() posts the prompt;
// the model calls tools; each call arrives via window.__writeNativeAIToolCall,
// runs through the executor, and replies over the same message handler; the
// final text resolves the promise.

export type NativeAgentEvent = { type: "tool"; name: string };

export type NativeAgentToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  requestTag?: string,
) => Promise<unknown>;

let toolExecutor: NativeAgentToolExecutor | null = null;
const scopedToolExecutors = new Map<string, NativeAgentToolExecutor>();
const agentEventHandlers = new Map<string, (event: NativeAgentEvent) => void>();
let globalsInstalled = false;

function postToolReply(callId: string, ok: boolean, result: string) {
  const handler = (
    window as unknown as {
      webkit?: {
        messageHandlers?: {
          nativeAI?: { postMessage: (body: unknown) => void };
        };
      };
    }
  ).webkit?.messageHandlers?.nativeAI;
  handler?.postMessage({ toolReply: { callId, ok, result } });
}

function installAgentGlobals() {
  if (typeof window === "undefined") return;
  const target = window as unknown as {
    __writeNativeAIToolCall?: (
      callId: string,
      name: string,
      argsJSON: string,
      eventTag: string,
    ) => boolean;
    __writeNativeAIAgentEvent?: (tag: string, event: NativeAgentEvent) => void;
  };
  if (
    globalsInstalled &&
    target.__writeNativeAIToolCall &&
    target.__writeNativeAIAgentEvent
  ) {
    return;
  }
  globalsInstalled = true;
  target.__writeNativeAIToolCall = (callId, name, argsJSON, eventTag) => {
    const executor = scopedToolExecutors.get(eventTag) ?? toolExecutor;
    if (!executor) return false;
    void (async () => {
      try {
        const args = (JSON.parse(argsJSON) ?? {}) as Record<string, unknown>;
        const result = await executor(name, args, eventTag);
        postToolReply(callId, true, JSON.stringify(result ?? { ok: true }));
      } catch (error) {
        postToolReply(
          callId,
          false,
          error instanceof Error ? error.message : "Tool failed",
        );
      }
    })();
    return true;
  };
  target.__writeNativeAIAgentEvent = (tag, event) => {
    agentEventHandlers.get(tag)?.(event);
  };
}

/**
 * Register the page-side executor for agent tool calls (see agent-tools.ts
 * for the workspace implementation). Call once when the assistant mounts;
 * returns an unregister function.
 */
export function registerNativeAgentTools(
  executor: NativeAgentToolExecutor,
): () => void {
  installAgentGlobals();
  toolExecutor = executor;
  return () => {
    if (toolExecutor === executor) toolExecutor = null;
  };
}

/**
 * Run an agentic command on the on-device model ("create three posts
 * about..."). Requires a registered tool executor. `context` is a short
 * plain-text description of what the user is looking at; `tools` restricts
 * the tool surface; `onEvent` observes tool calls for progress UI.
 */
export async function nativeAgent(
  prompt: string,
  options: {
    context?: string;
    instructions?: string;
    tools?: string[];
    toolExecutor?: NativeAgentToolExecutor;
    onEvent?: (event: NativeAgentEvent) => void;
  } = {},
): Promise<{ text: string; truncated: boolean }> {
  installAgentGlobals();
  const eventTag = `tag${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  if (options.onEvent) agentEventHandlers.set(eventTag, options.onEvent);
  if (options.toolExecutor) {
    scopedToolExecutors.set(eventTag, options.toolExecutor);
  }
  try {
    return await request("agent", {
      prompt,
      context: options.context,
      instructions: options.instructions,
      tools: options.tools,
      eventTag,
    });
  } finally {
    agentEventHandlers.delete(eventTag);
    scopedToolExecutors.delete(eventTag);
  }
}
