// Server-only: this module reads node:crypto + the DB. It is never imported by
// a client component (WorkspaceSettings imports only the CloudAiProvider type),
// and the decrypted key is used solely in the /api/ai route.
import { and, eq, isNull } from "drizzle-orm";
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

/** Dev only: point provider checks at the same local mock the assistant
 * route may use. Production always returns null. */
function devAiBaseUrl(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return process.env.TEXTTEXT_AI_BASE_URL || null;
}

export type { CloudAiProvider } from "@/lib/ai/provider-catalog";
type CloudProviderLabel = "Anthropic" | "OpenAI";

export type WorkspaceAiConfig = {
  provider: CloudAiProvider;
  model: string;
  apiKey: string;
};

type WorkspaceAiConfigStatus = {
  configured: boolean;
  provider: CloudAiProvider | null;
  model: string | null;
};

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
  // Development with TEXTTEXT_DEV_AI_KEY set: the stored key is never the one
  // that talks to the provider, because /api/ai substitutes the Keychain key at
  // request time. Validating the placeholder would then be theatre that makes
  // the assistant impossible to configure in dev without either putting a real
  // credential through a form or running the mock. Production never takes this
  // branch: the guard requires both a non-production build and the dev key.
  if (process.env.NODE_ENV !== "production" && process.env.TEXTTEXT_DEV_AI_KEY) {
    return;
  }
  const endpoint =
    provider === "openai"
      ? `${devAiBaseUrl() ?? "https://api.openai.com/v1"}/models/${encodeURIComponent(model)}`
      : `${devAiBaseUrl() ?? "https://api.anthropic.com/v1"}/models/${encodeURIComponent(model)}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers:
      provider === "openai"
        ? { Authorization: `Bearer ${apiKey}` }
        : {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? `That ${cloudProviderLabel(provider)} API key was not accepted.`
        : `The selected ${cloudProviderLabel(provider)} model is not available to this API account.`,
    );
  }
}

export async function getWorkspaceAiConfigStatus(
  blogId: string,
): Promise<WorkspaceAiConfigStatus> {
  const development = developmentWorkspaceAiConfig();
  if (development) {
    return {
      configured: true,
      provider: development.provider,
      model: development.model,
    };
  }
  if (!db) return { configured: false, provider: null, model: null };
  const [row] = await db
    .select({
      provider: workspaceAiConfigs.provider,
      model: workspaceAiConfigs.model,
    })
    .from(workspaceAiConfigs)
    .where(eq(workspaceAiConfigs.blogId, blogId))
    .limit(1);
  const provider = row?.provider;
  return isCloudAiProvider(provider)
    ? {
        configured: true,
        provider,
        model: isCloudAiModel(provider, row.model)
          ? row.model
          : defaultCloudAiModel(provider),
      }
    : { configured: false, provider: null, model: null };
}

export async function getWorkspaceAiConfigStatusForOwner(
  sub: string,
): Promise<WorkspaceAiConfigStatus> {
  const development = developmentWorkspaceAiConfig();
  if (development) {
    return {
      configured: true,
      provider: development.provider,
      model: development.model,
    };
  }
  if (!db) return { configured: false, provider: null, model: null };
  const [row] = await db
    .select({
      provider: workspaceAiConfigs.provider,
      model: workspaceAiConfigs.model,
    })
    .from(workspaceAiConfigs)
    .innerJoin(blogs, eq(workspaceAiConfigs.blogId, blogs.id))
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.appleSub, sub), isNull(blogs.deletedAt)))
    .limit(1);
  return isCloudAiProvider(row?.provider)
    ? {
        configured: true,
        provider: row.provider,
        model: isCloudAiModel(row.provider, row.model)
          ? row.model
          : defaultCloudAiModel(row.provider),
      }
    : { configured: false, provider: null, model: null };
}

export async function saveWorkspaceAiConfig(
  blogId: string,
  provider: CloudAiProvider,
  model: string,
  apiKey: string,
): Promise<void> {
  if (!db) throw new Error("Cloud AI settings need a configured database.");
  const apiKeyCiphertext = encryptWorkspaceAiKey(apiKey);
  await db
    .insert(workspaceAiConfigs)
    .values({ blogId, provider, model, apiKeyCiphertext })
    .onConflictDoUpdate({
      target: workspaceAiConfigs.blogId,
      set: { provider, model, apiKeyCiphertext, updatedAt: new Date() },
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
): Promise<WorkspaceAiConfig | null> {
  const development = developmentWorkspaceAiConfig();
  if (development) return development;
  if (!db) return null;
  const [row] = await db
    .select({
      provider: workspaceAiConfigs.provider,
      model: workspaceAiConfigs.model,
      apiKeyCiphertext: workspaceAiConfigs.apiKeyCiphertext,
    })
    .from(workspaceAiConfigs)
    .innerJoin(blogs, eq(workspaceAiConfigs.blogId, blogs.id))
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.appleSub, sub), isNull(blogs.deletedAt)))
    .limit(1);
  if (!row || !isCloudAiProvider(row.provider)) return null;
  return {
    provider: row.provider,
    model: isCloudAiModel(row.provider, row.model)
      ? row.model
      : defaultCloudAiModel(row.provider),
    apiKey: decryptWorkspaceAiKey(row.apiKeyCiphertext),
  };
}
