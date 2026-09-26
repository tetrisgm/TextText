type EmbeddedAiSurface = "mac" | "web";

type AiConnectionState =
  | "unavailable"
  | "runtime-missing"
  | "signed-out"
  | "unverified"
  | "connecting"
  | "ready"
  | "rate-limited"
  | "incompatible-runtime"
  | "failed";

type AiConnectionKind = "native-codex" | "api-key" | "external-mcp";

export type AiConnectionSnapshot = {
  state: AiConnectionState;
  phase?: "authorizing" | "checking" | null;
  verificationUrl?: string | null;
  userCode?: string | null;
  message?: string | null;
  diagnosticId?: string | null;
  model?: string | null;
  kind: AiConnectionKind | null;
  providerLabel: string | null;
  accountEmail: string | null;
  planLabel: string | null;
  runtimeVersion: string | null;
  rateLimitResetAt: number | null;
  lastHealthCheckAt: number | null;
  embeddedChatSupported: boolean;
  recoveryAction:
    | "connect"
    | "retry"
    | "install-runtime"
    | "upgrade-runtime"
    | "wait"
    | "open-settings"
    | null;
};

/** Device credentials are displayed only for the provider's fixed public page. */
export function nativeDeviceAuthorization(connection: Pick<AiConnectionSnapshot, "phase" | "verificationUrl" | "userCode"> | null | undefined): { url: string; code: string } | null {
  if (connection?.phase !== "authorizing" || connection.verificationUrl !== "https://auth.openai.com/codex/device" ||
      !connection.userCode || !/^[A-Z0-9-]{4,32}$/.test(connection.userCode)) return null;
  return { url: connection.verificationUrl, code: connection.userCode };
}

type NativeAiCapability = {
  surface: EmbeddedAiSurface;
  runtimeAvailable: boolean;
  runtimeVersion?: string | null;
  account?: {
    email?: string | null;
    planType?: string | null;
  } | null;
  rateLimitResetAt?: number | null;
  rateLimitReached?: boolean;
  lastHealthCheckAt?: number | null;
  error?: "runtime-missing" | "incompatible-runtime" | "failed";
};

export function resolveNativeAiConnection(
  capability: NativeAiCapability | null | undefined,
): AiConnectionSnapshot {
  if (!capability || capability.surface !== "mac") {
    return {
      state: "unavailable",
      kind: "native-codex",
      providerLabel: "Codex with ChatGPT",
      accountEmail: null,
      planLabel: null,
      runtimeVersion: null,
      rateLimitResetAt: null,
      lastHealthCheckAt: null,
      embeddedChatSupported: false,
      recoveryAction: null,
    };
  }

  const common = {
    kind: "native-codex" as const,
    providerLabel: "Codex with ChatGPT",
    accountEmail: capability.account?.email ?? null,
    planLabel: capability.account?.planType ?? null,
    runtimeVersion: capability.runtimeVersion ?? null,
    rateLimitResetAt: capability.rateLimitResetAt ?? null,
    lastHealthCheckAt: capability.lastHealthCheckAt ?? null,
    embeddedChatSupported: capability.runtimeAvailable,
  };

  if (capability.error === "runtime-missing") {
    return { ...common, state: "runtime-missing", recoveryAction: "install-runtime" };
  }
  if (capability.error === "incompatible-runtime") {
    return { ...common, state: "incompatible-runtime", recoveryAction: "upgrade-runtime" };
  }
  if (capability.error === "failed") {
    return { ...common, state: "failed", recoveryAction: "retry" };
  }
  if (!capability.runtimeAvailable) {
    return { ...common, state: "unavailable", embeddedChatSupported: false, recoveryAction: null };
  }
  if (capability.rateLimitReached) {
    return { ...common, state: "rate-limited", recoveryAction: "wait" };
  }
  if (!capability.account) {
    return { ...common, state: "signed-out", recoveryAction: "connect" };
  }
  return capability.lastHealthCheckAt
    ? { ...common, state: "ready", recoveryAction: null }
    : { ...common, state: "unverified", recoveryAction: "connect" };
}
