// Server-only: this module reads node:crypto + the DB. It is never imported by
// a client component (WorkspaceSettings imports only the CloudAiProvider type),
// and the decrypted key is used solely in the /api/ai route.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
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
export type CloudProviderLabel = "Anthropic" | "OpenAI";

export type WorkspaceAiConfig = {
  provider: CloudAiProvider;
  model: string;
  apiKey: string;
};

export type WorkspaceAiConfigStatus = {
  configured: boolean;
  provider: CloudAiProvider | null;
  model: string | null;
};

const CIPHER_VERSION = "v1";
const IV_BYTES = 12;

export { isCloudAiProvider };

export function cloudProviderLabel(
  provider: CloudAiProvider,
): CloudProviderLabel {
  return CLOUD_AI_CATALOG[provider].label;
}

function encryptionKey(): Buffer {
  const secret =
    process.env.AI_CONFIG_ENCRYPTION_KEY ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("AI key storage needs a server encryption secret.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptWorkspaceAiKey(apiKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptWorkspaceAiKey(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(":");
  if (
    version !== CIPHER_VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra !== undefined
  ) {
    throw new Error("The stored AI key could not be read.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function validateWorkspaceAiConnection(
  provider: CloudAiProvider,
  model: string,
  apiKey: string,
): Promise<void> {
  const endpoint =
    provider === "openai"
      ? `https://api.openai.com/v1/models/${encodeURIComponent(model)}`
      : `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`;
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
