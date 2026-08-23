"use server";

// Agent connection management for the signed-in user. Raw token values leave
// the server exactly once, while every stored capability remains revocable.

import { isAuthConfigured } from "@/auth";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  type ApiTokenKind,
  type ApiTokenSummary,
} from "@/lib/api-tokens";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same guard as the editor actions: tokens always require a signed-in user;
// with auth off there is no machine surface.
async function tokenOwnerId(): Promise<string> {
  if (!isAuthConfigured) throw new Error("API tokens require signing in");
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const userId = await getUserIdBySub(user.sub);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

function cleanTokenName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Token name must be text");
  const name = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!name) throw new Error("Name the token, e.g. the machine it is for");
  return name;
}

function cleanTokenId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) {
    throw new Error("Token not found");
  }
  return value.trim();
}

export async function createApiTokenAction(
  name: unknown,
  kind: unknown = "mcp",
): Promise<ApiTokenSummary & { token: string }> {
  const userId = await tokenOwnerId();
  const tokenKind = cleanTokenKind(kind);
  const { raw, record } = await createApiToken(userId, cleanTokenName(name), {
    kind: tokenKind,
  });
  return { ...record, token: raw };
}

function cleanTokenKind(value: unknown): ApiTokenKind {
  if (
    value === "manual" ||
    value === "mcp" ||
    value === "cli" ||
    value === "native" ||
    value === "app" ||
    value === "other"
  ) {
    return value;
  }
  throw new Error("Unknown connection type");
}

export async function listApiTokensAction(): Promise<ApiTokenSummary[]> {
  return listApiTokens(await tokenOwnerId());
}

export async function revokeApiTokenAction(id: unknown): Promise<void> {
  const userId = await tokenOwnerId();
  const revoked = await revokeApiToken(userId, cleanTokenId(id));
  if (!revoked) throw new Error("Token not found");
}
