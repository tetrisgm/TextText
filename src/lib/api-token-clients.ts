import type { ApiTokenSummary } from "./api-tokens";

export type ApiTokenClient = {
  key: string;
  name: string;
  kind: ApiTokenSummary["kind"];
  tokenIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

function newest(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

/**
 * OAuth and app reconnects can rotate credentials without creating a new
 * logical client. Settings presents that client once and disconnects every
 * live credential behind it, instead of calling each rotation a separate app.
 */
export function groupApiTokenClients(
  tokens: ApiTokenSummary[],
): ApiTokenClient[] {
  const clients = new Map<string, ApiTokenClient>();
  for (const token of tokens) {
    const key = JSON.stringify([token.kind, token.name]);
    const current = clients.get(key);
    if (!current) {
      clients.set(key, {
        key,
        name: token.name,
        kind: token.kind,
        tokenIds: [token.id],
        createdAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
      });
      continue;
    }
    current.tokenIds.push(token.id);
    current.createdAt = newest(current.createdAt, token.createdAt)!;
    current.lastUsedAt = newest(current.lastUsedAt, token.lastUsedAt);
  }
  return [...clients.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}
