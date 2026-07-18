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

export const CLOUD_AI_PROVIDERS = ["anthropic", "openai"] as const;
export type CloudAiProvider = (typeof CLOUD_AI_PROVIDERS)[number];
export type CloudProviderLabel = "Anthropic" | "OpenAI";

export type WorkspaceAiConfig = {
  provider: CloudAiProvider;
  apiKey: string;
};

export type WorkspaceAiConfigStatus = {
  configured: boolean;
  provider: CloudAiProvider | null;
};

const CIPHER_VERSION = "v1";
const IV_BYTES = 12;

export function isCloudAiProvider(value: unknown): value is CloudAiProvider {
  return CLOUD_AI_PROVIDERS.some((provider) => provider === value);
}

export function cloudProviderLabel(
  provider: CloudAiProvider,
): CloudProviderLabel {
  return provider === "anthropic" ? "Anthropic" : "OpenAI";
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

export async function getWorkspaceAiConfigStatus(
  blogId: string,
): Promise<WorkspaceAiConfigStatus> {
  if (!db) return { configured: false, provider: null };
  const [row] = await db
    .select({ provider: workspaceAiConfigs.provider })
    .from(workspaceAiConfigs)
    .where(eq(workspaceAiConfigs.blogId, blogId))
    .limit(1);
  const provider = row?.provider;
  return isCloudAiProvider(provider)
    ? { configured: true, provider }
    : { configured: false, provider: null };
}

export async function getWorkspaceAiConfigStatusForOwner(
  sub: string,
): Promise<WorkspaceAiConfigStatus> {
  if (!db) return { configured: false, provider: null };
  const [row] = await db
    .select({ provider: workspaceAiConfigs.provider })
    .from(workspaceAiConfigs)
    .innerJoin(blogs, eq(workspaceAiConfigs.blogId, blogs.id))
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.appleSub, sub), isNull(blogs.deletedAt)))
    .limit(1);
  return isCloudAiProvider(row?.provider)
    ? { configured: true, provider: row.provider }
    : { configured: false, provider: null };
}

export async function saveWorkspaceAiConfig(
  blogId: string,
  provider: CloudAiProvider,
  apiKey: string,
): Promise<void> {
  if (!db) throw new Error("Cloud AI settings need a configured database.");
  const apiKeyCiphertext = encryptWorkspaceAiKey(apiKey);
  await db
    .insert(workspaceAiConfigs)
    .values({ blogId, provider, apiKeyCiphertext })
    .onConflictDoUpdate({
      target: workspaceAiConfigs.blogId,
      set: { provider, apiKeyCiphertext, updatedAt: new Date() },
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
    apiKey: decryptWorkspaceAiKey(row.apiKeyCiphertext),
  };
}
