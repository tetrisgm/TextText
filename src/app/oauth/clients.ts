import { randomBytes } from "node:crypto";
import { isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthClients } from "@/lib/db/schema";
import {
  OAUTH_SCOPE,
  isOAuthScope,
  loadOAuthClientsFromEnv,
  type OAuthClient,
  type OAuthScope,
} from "@/lib/oauth";

const CLIENT_ID_RE = /^[A-Za-z0-9._~-]{1,128}$/;
const CLIENT_ID_BYTES = 24;
const CLIENT_ID_PREFIX = "wcl_";
const INSERT_ATTEMPTS = 3;

export type RegisteredOAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scope: OAuthScope;
  createdAt: Date;
};

export class OAuthClientRegistrationError extends Error {
  readonly status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "OAuthClientRegistrationError";
    this.status = status;
  }
}

function generateClientId(): string {
  return `${CLIENT_ID_PREFIX}${randomBytes(CLIENT_ID_BYTES).toString(
    "base64url",
  )}`;
}

function cleanRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function registeredClientFromRow(row: {
  clientId: string;
  clientName: string;
  redirectUris: unknown;
  scope: string;
}): OAuthClient | null {
  if (!CLIENT_ID_RE.test(row.clientId)) return null;
  if (!isOAuthScope(row.scope)) return null;
  const redirectUris = cleanRedirectUris(row.redirectUris);
  if (redirectUris.length === 0) return null;
  return {
    clientId: row.clientId,
    name: row.clientName,
    redirectUris,
    defaultScope: row.scope,
  };
}

export async function loadOAuthClients(): Promise<OAuthClient[]> {
  const clients = loadOAuthClientsFromEnv();
  const seen = new Set(clients.map((client) => client.clientId));

  if (!db) return clients;

  const rows = await db
    .select({
      clientId: oauthClients.clientId,
      clientName: oauthClients.clientName,
      redirectUris: oauthClients.redirectUris,
      scope: oauthClients.scope,
    })
    .from(oauthClients)
    .where(isNull(oauthClients.revokedAt));

  for (const row of rows) {
    const client = registeredClientFromRow(row);
    if (!client || seen.has(client.clientId)) continue;
    clients.push(client);
    seen.add(client.clientId);
  }

  return clients;
}

export async function createRegisteredOAuthClient(input: {
  clientName: string;
  redirectUris: string[];
  scope?: OAuthScope;
}): Promise<RegisteredOAuthClient> {
  if (!db) {
    throw new OAuthClientRegistrationError(
      "OAuth client registration requires DATABASE_URL",
    );
  }

  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt += 1) {
    const clientId = generateClientId();
    const inserted = await db
      .insert(oauthClients)
      .values({
        clientId,
        clientName: input.clientName,
        redirectUris: input.redirectUris,
        scope: input.scope ?? OAUTH_SCOPE,
      })
      .onConflictDoNothing({ target: oauthClients.clientId })
      .returning({
        clientId: oauthClients.clientId,
        clientName: oauthClients.clientName,
        redirectUris: oauthClients.redirectUris,
        scope: oauthClients.scope,
        createdAt: oauthClients.createdAt,
      });

    const row = inserted[0];
    if (row && isOAuthScope(row.scope)) {
      return {
        clientId: row.clientId,
        clientName: row.clientName,
        redirectUris: row.redirectUris,
        scope: row.scope,
        createdAt: row.createdAt,
      };
    }
  }

  throw new OAuthClientRegistrationError(
    "Could not allocate an OAuth client_id",
    500,
  );
}
