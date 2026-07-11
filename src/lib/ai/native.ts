// Typed client for the Mac app's on-device AI bridge (NativeAI.swift). The
// bridge exists only inside Write.app on the workspace origin; on the plain
// web these helpers report unavailable and the assistant falls back to a
// configured cloud provider. Provider ladder: native on-device first (free,
// private, offline), then bring-your-own cloud, then external agents via MCP.

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
    return { available: false, ocr: false, imageUnderstanding: false };
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
