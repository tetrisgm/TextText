// Server-only: this module reads node:crypto + the DB. It is never imported by
// a client component (WorkspaceSettings imports only the CloudAiProvider type),
// and the decrypted key is used solely for server-side provider requests.
import { and, eq, isNull, lte } from "drizzle-orm";
import { generateText } from "ai";
import { workspaceLanguageModel } from "@/lib/ai/provider-model.server";
import { AiConnectionError, aiFailure, aiRequestId, classifyAiFailure, isAiFailureCode, type AiFailure } from "@/lib/ai/provider-failure";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { db } from "@/lib/db/client";
import { blogs, users, workspaceAiConfigs } from "@/lib/db/schema";
import {
  CLOUD_AI_CATALOG,
  defaultCloudAiModel,
  isCloudAiModel,
  isCloudAiProvider,
  type CloudAiProvider,
} from "@/lib/ai/provider-catalog";

export type { CloudAiProvider } from "@/lib/ai/provider-catalog";
type CloudProviderLabel = "Anthropic" | "OpenAI";

export type WorkspaceAiConfig = {
  provider: CloudAiProvider;
  model: string;
  apiKey: string;
  /** Fences late health updates against replacement or a newer attempt. Server-only. */
  source?: { blogId: string; ciphertext: string; model: string; attemptStartedAt: Date };
};

export type WorkspaceAiConfigStatus = {
  configured: boolean;
  provider: CloudAiProvider | null;
  model: string | null;
  connectionState: "not-set-up" | "unchecked" | "ready" | "needs-attention";
  checkedAt: string | null;
  failure?: AiFailure;
};

const NOT_CONFIGURED: WorkspaceAiConfigStatus = { configured: false, provider: null, model: null, connectionState: "not-set-up", checkedAt: null };

function configStatus(row: { provider: unknown; model: string; checkedAt?: Date | null; failureCode?: string | null; failureRequestId?: string | null } | undefined): WorkspaceAiConfigStatus {
  if (!row || !isCloudAiProvider(row.provider)) return { ...NOT_CONFIGURED };
  const failure = isAiFailureCode(row.failureCode)
    ? aiFailure(row.failureCode, aiRequestId(row.failureRequestId))
    : !isCloudAiModel(row.provider, row.model) ? aiFailure("model-access", aiRequestId()) : undefined;
  return {
    configured: true,
    provider: row.provider,
    model: row.model,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    connectionState: failure ? "needs-attention" : row.checkedAt ? "ready" : "unchecked",
    ...(failure ? { failure } : {}),
  };
}

export function developmentWorkspaceAiConfig(): WorkspaceAiConfig | null {
  if (
    process.env.NODE_ENV === "production" ||
    !process.env.TEXTTEXT_DEV_AI_KEY ||
    !isCloudAiProvider(process.env.TEXTTEXT_DEV_AI_PROVIDER)
  ) {
    return null;
  }
  const provider = process.env.TEXTTEXT_DEV_AI_PROVIDER;
  return {
    provider,
    model: defaultCloudAiModel(provider),
    // workspaceLanguageModel reads the real value directly from the process.
    // Keeping it out of this object prevents accidental logging by callers.
    apiKey: "keychain-development-override",
  };
}

export { isCloudAiProvider };

export function cloudProviderLabel(
  provider: CloudAiProvider,
): CloudProviderLabel {
  return CLOUD_AI_CATALOG[provider].label;
}

export function encryptWorkspaceAiKey(apiKey: string): string {
  return encryptSecret(apiKey);
}

export function decryptWorkspaceAiKey(value: string): string {
  try {
    return decryptSecret(value);
  } catch {
    throw new Error("The stored AI key could not be read.");
  }
}

export async function validateWorkspaceAiConnection(
  provider: CloudAiProvider,
  model: string,
  apiKey: string,
): Promise<void> {
  const requestId = aiRequestId();
  const signal = AbortSignal.timeout(15_000);
  try {
    // Exercise the same SDK and generation endpoint as the requested preview.
    // The explicit supplied key must not be replaced by a developer override.
    const result = await generateText({
      model: workspaceLanguageModel({ provider, model, apiKey }, { useDevelopmentOverride: false }),
      prompt: "Reply with the single word OK.",
      maxOutputTokens: 32,
      maxRetries: 0,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    if (!result.text.trim()) throw new Error("Empty generation response");
  } catch (error) {
    const failure = classifyAiFailure(signal.aborted ? signal.reason : error, requestId);
    console.error("ai connection check failed", { provider, model, ...failure });
    throw new AiConnectionError(failure);
  }
}

export async function getWorkspaceAiConfigStatus(
  blogId: string,
): Promise<WorkspaceAiConfigStatus> {
  const development = developmentWorkspaceAiConfig();
  if (development) {
    return configStatus(development);
  }
  if (!db) return { ...NOT_CONFIGURED };
  const [row] = await db
    .select({
      provider: workspaceAiConfigs.provider,
      model: workspaceAiConfigs.model,
      checkedAt: workspaceAiConfigs.checkedAt,
      failureCode: workspaceAiConfigs.failureCode,
      failureRequestId: workspaceAiConfigs.failureRequestId,
    })
    .from(workspaceAiConfigs)
    .where(eq(workspaceAiConfigs.blogId, blogId))
    .limit(1);
  return configStatus(row);
}

export async function getWorkspaceAiConfigStatusForOwner(
  sub: string,
): Promise<WorkspaceAiConfigStatus> {
  const development = developmentWorkspaceAiConfig();
  if (development) {
    return configStatus(development);
  }
  if (!db) return { ...NOT_CONFIGURED };
  const [row] = await db
    .select({
      provider: workspaceAiConfigs.provider,
      model: workspaceAiConfigs.model,
      checkedAt: workspaceAiConfigs.checkedAt,
      failureCode: workspaceAiConfigs.failureCode,
      failureRequestId: workspaceAiConfigs.failureRequestId,
    })
    .from(workspaceAiConfigs)
    .innerJoin(blogs, eq(workspaceAiConfigs.blogId, blogs.id))
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.appleSub, sub), isNull(blogs.deletedAt)))
    .limit(1);
  return configStatus(row);
}

export async function saveWorkspaceAiConfig(
  blogId: string,
  provider: CloudAiProvider,
  model: string,
  apiKey: string,
): Promise<void> {
  if (!db) throw new Error("Cloud AI settings need a configured database.");
  const apiKeyCiphertext = encryptWorkspaceAiKey(apiKey);
  const checkedAt = new Date();
  await db
    .insert(workspaceAiConfigs)
    .values({ blogId, provider, model, apiKeyCiphertext, checkedAt })
    .onConflictDoUpdate({
      target: workspaceAiConfigs.blogId,
      set: { provider, model, apiKeyCiphertext, updatedAt: new Date(), checkedAt, failureCode: null, failureRequestId: null },
    });
}

export async function removeWorkspaceAiConfig(blogId: string): Promise<void> {
  if (!db) throw new Error("Cloud AI settings need a configured database.");
  await db
    .delete(workspaceAiConfigs)
    .where(eq(workspaceAiConfigs.blogId, blogId));
}

// Provider requests resolve the key by authenticated owner identity. The row is
// never selected through a content query and this decrypted value never crosses
// a server boundary.
export async function getWorkspaceAiConfigForOwner(
  sub: string,
  requestId?: string,
): Promise<WorkspaceAiConfig | null> {
  const development = developmentWorkspaceAiConfig();
  if (development) return development;
  if (!db) return null;
  const attemptStartedAt = new Date();
  const [row] = await db
    .select({
      provider: workspaceAiConfigs.provider,
      model: workspaceAiConfigs.model,
      apiKeyCiphertext: workspaceAiConfigs.apiKeyCiphertext,
      blogId: workspaceAiConfigs.blogId,
    })
    .from(workspaceAiConfigs)
    .innerJoin(blogs, eq(workspaceAiConfigs.blogId, blogs.id))
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.appleSub, sub), isNull(blogs.deletedAt)))
    .limit(1);
  if (!row || !isCloudAiProvider(row.provider)) return null;
  const config: WorkspaceAiConfig = {
    provider: row.provider,
    model: row.model,
    apiKey: "",
    source: { blogId: row.blogId, ciphertext: row.apiKeyCiphertext, model: row.model, attemptStartedAt },
  };
  try { config.apiKey = decryptWorkspaceAiKey(row.apiKeyCiphertext); }
  catch {
    const failure = aiFailure("configuration", aiRequestId(requestId));
    await recordWorkspaceAiResult(config, failure);
    throw new AiConnectionError(failure);
  }
  return config;
}

/** Only a request using this exact saved configuration may update its proof.
 * No model request is made while reading status or launching the app. */
export async function recordWorkspaceAiResult(config: WorkspaceAiConfig, failure: AiFailure | null, selectedModel = config.model): Promise<void> {
  if (!db || !config.source || failure?.code === "cancelled" || failure?.code === "invalid-template") return;
  if (selectedModel !== config.source.model && failure?.code !== "authentication") return;
  try {
    await db.update(workspaceAiConfigs).set({
      updatedAt: config.source.attemptStartedAt,
      ...(failure
        ? { failureCode: failure.code, failureRequestId: failure.requestId }
        : { checkedAt: new Date(), failureCode: null, failureRequestId: null }),
    })
      .where(and(
        eq(workspaceAiConfigs.blogId, config.source.blogId),
        eq(workspaceAiConfigs.apiKeyCiphertext, config.source.ciphertext),
        eq(workspaceAiConfigs.provider, config.provider),
        eq(workspaceAiConfigs.model, config.source.model),
        lte(workspaceAiConfigs.updatedAt, config.source.attemptStartedAt),
      ));
  } catch {
    // The authoritative generation outcome remains valid if its status write
    // fails. Do not turn it into a repeatable content mutation.
    console.error("ai connection status could not be recorded");
  }
}
