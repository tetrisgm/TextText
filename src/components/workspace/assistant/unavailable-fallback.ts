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

export function unavailableExplanation(
  capabilities: NativeAICapabilities | null,
): string {
  if (!hasNativeAI()) {
    return "The on-device assistant is available inside Write for Mac.";
  }
  switch (capabilities?.reason) {
    case "appleIntelligenceNotEnabled":
      return "Apple Intelligence is turned off. Enable it in System Settings, then try again.";
    case "modelNotReady":
      return "The on-device model is still downloading. Try again in a few minutes.";
    case "deviceNotEligible":
      return "This Mac does not support Apple Intelligence.";
    case "osTooOld":
      return "On-device AI needs macOS 26 or later.";
    default:
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

export async function fallbackForNativeAssetError({
  context,
  error,
  onCloudStart,
  prompt,
  reprobe,
}: {
  context?: CloudAssistantContext;
  error: unknown;
  onCloudStart?: (provider: CloudAssistantProviderLabel) => void;
  prompt: string;
  reprobe: () => Promise<NativeAICapabilities>;
}): Promise<
  | { capabilities: NativeAICapabilities; message: GracefulFallbackMessage }
  | null
> {
  if (!isNativeModelAssetError(error)) return null;
  const capabilities = await reprobe();
  const message = await runUnavailableAssistantFallback({
    capabilities,
    context,
    onCloudStart,
    prompt,
  });
  return { capabilities, message };
}
