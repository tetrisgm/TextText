import {
  cloudAssistantStatus,
  cloudAssistantTurn,
  type CloudAssistantContext,
  type CloudAssistantProviderLabel,
} from "@/lib/ai/cloud-client";
import {
  hasNativeAI,
  isNativeModelAssetError,
  type NativeAICapabilities,
} from "@/lib/ai/native";

export type GracefulFallbackMessage = {
  role: "assistant";
  text: string;
  provider?: CloudAssistantProviderLabel;
};

export type NativeAssetPreparationState = "preparing" | "downloading";

export type NativeAssetRetryOutcome<T> =
  | {
      kind: "recovered";
      capabilities: NativeAICapabilities;
      value: T;
    }
  | {
      kind: "fallback";
      capabilities: NativeAICapabilities;
      message: GracefulFallbackMessage;
    };

const DEFAULT_ASSET_RETRY_DELAYS_MS = [600, 1_200, 2_400] as const;

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isGenuineNativeUnavailability(
  capabilities: NativeAICapabilities,
): boolean {
  return (
    !capabilities.available &&
    capabilities.reason !== "modelNotReady" &&
    capabilities.reason !== "unavailable"
  );
}

export function unavailableExplanation(
  capabilities: NativeAICapabilities | null,
): string {
  if (!hasNativeAI()) {
    return "The on-device assistant is available inside Texttext for Mac.";
  }
  switch (capabilities?.reason) {
    case "appleIntelligenceNotEnabled":
      return "Apple Intelligence is turned off. Enable it in System Settings, then try again.";
    case "modelNotReady":
      return "The Apple Intelligence model runs on this Mac. macOS is preparing it automatically, and Texttext will use it as soon as it is ready.";
    case "deviceNotEligible":
      return "This Mac does not support Apple Intelligence.";
    case "osTooOld":
      return "On-device AI needs macOS 26 or later.";
    default:
      if (capabilities?.available) {
        return "The on-device Assistant could not complete this request. Try again.";
      }
      return "On-device AI is unavailable right now.";
  }
}

export async function runUnavailableAssistantFallback({
  capabilities,
  context,
  onCloudStart,
  prompt,
}: {
  capabilities: NativeAICapabilities | null;
  context?: CloudAssistantContext;
  onCloudStart?: (provider: CloudAssistantProviderLabel) => void;
  prompt: string;
}): Promise<GracefulFallbackMessage> {
  let status;
  try {
    status = await cloudAssistantStatus();
  } catch {
    return { role: "assistant", text: unavailableExplanation(capabilities) };
  }
  if (!status.enabled || !status.provider) {
    return { role: "assistant", text: unavailableExplanation(capabilities) };
  }

  onCloudStart?.(status.provider);
  try {
    const outcome = await cloudAssistantTurn(prompt, context);
    if ("disabled" in outcome) {
      return { role: "assistant", text: unavailableExplanation(capabilities) };
    }
    return {
      role: "assistant",
      text: outcome.text || "Done.",
      provider: outcome.provider,
    };
  } catch {
    return {
      role: "assistant",
      text: `The configured cloud assistant could not finish. ${unavailableExplanation(capabilities)}`,
    };
  }
}

export async function fallbackForNativeAssetError<T>({
  context,
  error,
  onCloudStart,
  onPreparing,
  prompt,
  reprobe,
  retryNative,
  retryDelaysMs = DEFAULT_ASSET_RETRY_DELAYS_MS,
}: {
  context?: CloudAssistantContext;
  error: unknown;
  onCloudStart?: (provider: CloudAssistantProviderLabel) => void;
  onPreparing?: (
    state: NativeAssetPreparationState,
    attempt: number,
    maximumAttempts: number,
  ) => void;
  prompt: string;
  reprobe: () => Promise<NativeAICapabilities>;
  retryNative: () => Promise<T>;
  retryDelaysMs?: readonly number[];
}): Promise<NativeAssetRetryOutcome<T> | null> {
  if (!isNativeModelAssetError(error)) return null;
  let capabilities = await reprobe();

  if (!isGenuineNativeUnavailability(capabilities)) {
    for (const [index, delayMs] of retryDelaysMs.entries()) {
      const attempt = index + 1;
      const state =
        capabilities.reason === "modelNotReady" ? "downloading" : "preparing";
      onPreparing?.(state, attempt, retryDelaysMs.length);
      await wait(delayMs);
      capabilities = await reprobe();
      if (isGenuineNativeUnavailability(capabilities)) break;
      try {
        const value = await retryNative();
        return { kind: "recovered", capabilities, value };
      } catch (retryError) {
        if (!isNativeModelAssetError(retryError)) throw retryError;
      }
    }
  }

  const message = await runUnavailableAssistantFallback({
    capabilities,
    context,
    onCloudStart,
    prompt,
  });
  return {
    kind: "fallback",
    capabilities,
    message,
  };
}
