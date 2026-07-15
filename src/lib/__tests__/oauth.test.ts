import { describe, expect, it, vi } from "vitest";
import {
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_REFRESH_ABSOLUTE_TTL_SECONDS,
  OAUTH_REFRESH_INACTIVITY_TTL_SECONDS,
  type OAuthAuthorizationCodeRecord,
  type OAuthAuthorizationCodeStore,
  type OAuthClient,
  type OAuthScope,
  type OAuthTokenStore,
  exchangeOAuthAuthorizationCode,
  generateOAuthRefreshToken,
  hashOAuthAuthorizationCode,
  hashOAuthRefreshToken,
  issueOAuthAuthorizationCode,
  issueOAuthTokenSet,
  oauthAuthorizationServerMetadata,
  parseOAuthScope,
  pkceS256Challenge,
  refreshOAuthAccessToken,
  validateOAuthAuthorizationParams,
  validateOAuthRedirectUri,
  verifyPkceS256,
} from "@/lib/oauth";

function memoryCodeStore(): {
  store: OAuthAuthorizationCodeStore;
  rows: Map<
    string,
    OAuthAuthorizationCodeRecord & {
      codeHash: string;
      expiresAt: Date;
      consumedAt: Date | null;
    }
  >;
} {
  const rows = new Map<
    string,
    OAuthAuthorizationCodeRecord & {
      codeHash: string;
      expiresAt: Date;
      consumedAt: Date | null;
    }
  >();

  return {
    rows,
    store: {
      async insert(input) {
        rows.set(input.codeHash, { ...input, consumedAt: null });
      },
      async consume(input) {
        const row = rows.get(input.codeHash);
        if (
          !row ||
          row.consumedAt ||
          row.expiresAt <= input.now ||
          row.clientId !== input.clientId ||
          row.redirectUri !== input.redirectUri
        ) {
          return null;
        }
        row.consumedAt = input.now;
        return {
          userId: row.userId,
          clientId: row.clientId,
          redirectUri: row.redirectUri,
          codeChallenge: row.codeChallenge,
          scope: row.scope,
        };
      },
    },
  };
}

type MemoryFamily = {
  clientId: string;
  scope: OAuthScope;
  absoluteExpiresAt: Date;
  inactivityExpiresAt: Date;
  revoked: boolean;
};

function memoryTokenStore(accessCharacter = "a") {
  const families = new Map<string, MemoryFamily>();
  const refreshRows = new Map<
    string,
    { familyId: string; consumed: boolean }
  >();
  let issuedAccessTokens = 0;

  const store: OAuthTokenStore = {
    issue: vi.fn(async (input) => {
      families.set(input.familyId, {
        clientId: input.clientId,
        scope: input.scope,
        absoluteExpiresAt: input.absoluteExpiresAt,
        inactivityExpiresAt: input.inactivityExpiresAt,
        revoked: false,
      });
      refreshRows.set(input.refreshTokenHash, {
        familyId: input.familyId,
        consumed: false,
      });
      issuedAccessTokens += 1;
      const suffix = issuedAccessTokens === 1 ? accessCharacter : "z";
      return { accessToken: `wsk_${suffix.repeat(43)}` };
    }),
    rotate: vi.fn(async (input) => {
      const row = refreshRows.get(input.presentedRefreshTokenHash);
      const family = row ? families.get(row.familyId) : undefined;
      if (!row || !family || family.clientId !== input.clientId) {
        return { status: "invalid" } as const;
      }
      if (row.consumed) {
        family.revoked = true;
        return { status: "replayed" } as const;
      }
      if (
        family.revoked ||
        family.absoluteExpiresAt <= input.now ||
        family.inactivityExpiresAt <= input.now
      ) {
        return { status: "invalid" } as const;
      }
      if (input.requestedScope && input.requestedScope !== family.scope) {
        return { status: "scope_mismatch" } as const;
      }

      row.consumed = true;
      family.inactivityExpiresAt = new Date(
        Math.min(
          family.absoluteExpiresAt.getTime(),
          input.newInactivityExpiresAt.getTime(),
        ),
      );
      refreshRows.set(input.newRefreshTokenHash, {
        familyId: row.familyId,
        consumed: false,
      });
      return { status: "rotated", scope: family.scope } as const;
    }),
  };

  return { families, refreshRows, store };
}

describe("PKCE S256", () => {
  it("matches the RFC 7636 S256 example", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    expect(pkceS256Challenge(verifier)).toBe(challenge);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects wrong, plain, and malformed verifiers", () => {
    const verifier = "a".repeat(43);
    const challenge = pkceS256Challenge(verifier);

    expect(verifyPkceS256(verifier.replace("a", "b"), challenge)).toBe(false);
    expect(verifyPkceS256(verifier, verifier)).toBe(false);
    expect(verifyPkceS256("short", challenge)).toBe(false);
    expect(verifyPkceS256(`${"a".repeat(42)}!`, challenge)).toBe(false);
  });
});

describe("OAuth scopes and metadata", () => {
  it("defaults existing clients to sync and accepts one explicit scope", () => {
    expect(parseOAuthScope(undefined)).toBe("sync");
    expect(parseOAuthScope("read")).toBe("read");
    expect(parseOAuthScope(undefined, "read")).toBe("read");
    expect(() => parseOAuthScope("read sync")).toThrowError(
      expect.objectContaining({ code: "invalid_scope" }),
    );
  });

  it("uses a dynamically registered client's read default", () => {
    const client: OAuthClient = {
      clientId: "reader",
      name: "Reader",
      redirectUris: ["https://reader.example/callback"],
      defaultScope: "read",
    };
    const validation = validateOAuthAuthorizationParams(
      new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: client.redirectUris[0],
        response_type: "code",
        code_challenge: pkceS256Challenge("v".repeat(43)),
        code_challenge_method: "S256",
      }),
      { clients: [client] },
    );

    expect(validation).toMatchObject({
      ok: true,
      request: { scope: "read" },
    });
  });

  it("advertises refresh rotation and both scopes", () => {
    expect(oauthAuthorizationServerMetadata("https://write.example/")).toMatchObject(
      {
        issuer: "https://write.example",
        grant_types_supported: ["authorization_code", "refresh_token"],
        scopes_supported: ["read", "sync"],
      },
    );
  });
});

describe("OAuth redirect_uri validation", () => {
  it("requires exact allowlist matches", () => {
    const client: OAuthClient = {
      clientId: "client",
      name: "Client",
      redirectUris: ["https://client.example/callback?fixed=1"],
    };

    expect(
      validateOAuthRedirectUri(
        client,
        "https://client.example/callback?fixed=1",
      ).ok,
    ).toBe(true);
    expect(
      validateOAuthRedirectUri(client, "https://client.example/callback").ok,
    ).toBe(false);
    expect(
      validateOAuthRedirectUri(
        client,
        "https://client.example/callback?fixed=1&next=https://evil.example",
      ).ok,
    ).toBe(false);
  });

  it("requires https except flagged dev localhost clients", () => {
    const prodClient: OAuthClient = {
      clientId: "prod",
      name: "Prod",
      redirectUris: ["http://localhost:3456/callback"],
    };
    const devClient: OAuthClient = {
      ...prodClient,
      clientId: "dev",
      dev: true,
    };

    expect(
      validateOAuthRedirectUri(devClient, "http://localhost:3456/callback").ok,
    ).toBe(false);
    expect(
      validateOAuthRedirectUri(devClient, "http://localhost:3456/callback", {
        allowInsecureLocalhost: true,
      }).ok,
    ).toBe(true);
    expect(
      validateOAuthRedirectUri(prodClient, "http://localhost:3456/callback", {
        allowInsecureLocalhost: true,
      }).ok,
    ).toBe(false);
  });

  it("rejects fragments and userinfo even when exactly registered", () => {
    const client: OAuthClient = {
      clientId: "strict",
      name: "Strict",
      redirectUris: [
        "https://client.example/callback#frag",
        "https://user@client.example/callback",
      ],
    };

    expect(
      validateOAuthRedirectUri(client, "https://client.example/callback#frag")
        .ok,
    ).toBe(false);
    expect(
      validateOAuthRedirectUri(client, "https://user@client.example/callback")
        .ok,
    ).toBe(false);
  });
});

describe("OAuth authorization codes", () => {
  const verifier = "z".repeat(43);
  const redirectUri = "https://client.example/callback";
  const client: OAuthClient = {
    clientId: "connector",
    name: "Connector",
    redirectUris: [redirectUri, "https://client.example/other-callback"],
  };

  it("stores only a code hash and exchanges once for an expiring token pair", async () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const { store, rows } = memoryCodeStore();
    const tokens = memoryTokenStore();
    const issued = await issueOAuthAuthorizationCode(
      {
        userId: "user-1",
        clientId: client.clientId,
        redirectUri,
        codeChallenge: pkceS256Challenge(verifier),
        now,
      },
      store,
    );

    expect(rows.has(hashOAuthAuthorizationCode(issued.code))).toBe(true);
    expect([...rows.keys()]).not.toContain(issued.code);

    const response = await exchangeOAuthAuthorizationCode(
      {
        code: issued.code,
        clientId: client.clientId,
        redirectUri,
        codeVerifier: verifier,
        now,
      },
      { clients: [client], store, tokenStore: tokens.store },
    );
    expect(response).toMatchObject({
      access_token: `wsk_${"a".repeat(43)}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "sync",
    });
    expect(response.refresh_token).toMatch(/^wrt_[A-Za-z0-9_-]{43}$/);

    const issueCall = vi.mocked(tokens.store.issue).mock.calls[0][0];
    expect(issueCall.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issueCall).not.toHaveProperty("refreshToken");
    expect(issueCall.accessTokenExpiresAt.getTime() - now.getTime()).toBe(
      OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
    );
    expect(issueCall.absoluteExpiresAt.getTime() - now.getTime()).toBe(
      OAUTH_REFRESH_ABSOLUTE_TTL_SECONDS * 1000,
    );
    expect(issueCall.inactivityExpiresAt.getTime() - now.getTime()).toBe(
      OAUTH_REFRESH_INACTIVITY_TTL_SECONDS * 1000,
    );

    await expect(
      exchangeOAuthAuthorizationCode(
        {
          code: issued.code,
          clientId: client.clientId,
          redirectUri,
          codeVerifier: verifier,
          now,
        },
        { clients: [client], store, tokenStore: tokens.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(tokens.store.issue).toHaveBeenCalledTimes(1);
  });

  it("binds the code to the exact redirect_uri", async () => {
    const { store } = memoryCodeStore();
    const tokens = memoryTokenStore("b");
    const issued = await issueOAuthAuthorizationCode(
      {
        userId: "user-1",
        clientId: client.clientId,
        redirectUri,
        codeChallenge: pkceS256Challenge(verifier),
      },
      store,
    );

    await expect(
      exchangeOAuthAuthorizationCode(
        {
          code: issued.code,
          clientId: client.clientId,
          redirectUri: "https://client.example/other-callback",
          codeVerifier: verifier,
        },
        { clients: [client], store, tokenStore: tokens.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });

    await expect(
      exchangeOAuthAuthorizationCode(
        {
          code: issued.code,
          clientId: client.clientId,
          redirectUri,
          codeVerifier: verifier,
        },
        { clients: [client], store, tokenStore: tokens.store },
      ),
    ).resolves.toMatchObject({ token_type: "Bearer", scope: "sync" });
  });

  it("burns the code on a failed PKCE verifier", async () => {
    const { store } = memoryCodeStore();
    const tokens = memoryTokenStore("c");
    const issued = await issueOAuthAuthorizationCode(
      {
        userId: "user-1",
        clientId: client.clientId,
        redirectUri,
        codeChallenge: pkceS256Challenge(verifier),
      },
      store,
    );

    await expect(
      exchangeOAuthAuthorizationCode(
        {
          code: issued.code,
          clientId: client.clientId,
          redirectUri,
          codeVerifier: "y".repeat(43),
        },
        { clients: [client], store, tokenStore: tokens.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(
      exchangeOAuthAuthorizationCode(
        {
          code: issued.code,
          clientId: client.clientId,
          redirectUri,
          codeVerifier: verifier,
        },
        { clients: [client], store, tokenStore: tokens.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(tokens.store.issue).not.toHaveBeenCalled();
  });
});

describe("OAuth refresh-token lifecycle", () => {
  const client: OAuthClient = {
    clientId: "connector",
    name: "Connector",
    redirectUris: ["https://client.example/callback"],
  };

  it("stores only refresh hashes, rotates, and revokes on replay", async () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const memory = memoryTokenStore();
    const initial = await issueOAuthTokenSet(
      {
        userId: "user-1",
        clientId: client.clientId,
        clientName: client.name,
        scope: "sync",
        now,
      },
      memory.store,
    );
    const rotated = await refreshOAuthAccessToken(
      {
        refreshToken: initial.refresh_token,
        clientId: client.clientId,
        now: new Date(now.getTime() + 60_000),
      },
      { clients: [client], store: memory.store },
    );

    expect(rotated).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "sync",
    });
    expect(rotated.access_token).not.toBe(initial.access_token);
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    expect([...memory.refreshRows.keys()]).toEqual(
      expect.arrayContaining([
        hashOAuthRefreshToken(initial.refresh_token),
        hashOAuthRefreshToken(rotated.refresh_token),
      ]),
    );
    expect([...memory.refreshRows.keys()].join(" ")).not.toContain("wrt_");

    await expect(
      refreshOAuthAccessToken(
        {
          refreshToken: initial.refresh_token,
          clientId: client.clientId,
          now: new Date(now.getTime() + 120_000),
        },
        { clients: [client], store: memory.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(
      refreshOAuthAccessToken(
        {
          refreshToken: rotated.refresh_token,
          clientId: client.clientId,
          now: new Date(now.getTime() + 180_000),
        },
        { clients: [client], store: memory.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect([...memory.families.values()][0].revoked).toBe(true);
  });

  it("rejects inactivity expiry and scope escalation without consuming", async () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const memory = memoryTokenStore();
    const read = await issueOAuthTokenSet(
      {
        userId: "user-1",
        clientId: client.clientId,
        clientName: client.name,
        scope: "read",
        now,
      },
      memory.store,
    );

    await expect(
      refreshOAuthAccessToken(
        {
          refreshToken: read.refresh_token,
          clientId: client.clientId,
          scope: "sync",
          now: new Date(now.getTime() + 1000),
        },
        { clients: [client], store: memory.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_scope" });
    await expect(
      refreshOAuthAccessToken(
        {
          refreshToken: read.refresh_token,
          clientId: client.clientId,
          now: new Date(now.getTime() + 2000),
        },
        { clients: [client], store: memory.store },
      ),
    ).resolves.toMatchObject({ scope: "read" });

    const staleMemory = memoryTokenStore();
    const stale = await issueOAuthTokenSet(
      {
        userId: "user-1",
        clientId: client.clientId,
        clientName: client.name,
        scope: "sync",
        now,
      },
      staleMemory.store,
    );
    await expect(
      refreshOAuthAccessToken(
        {
          refreshToken: stale.refresh_token,
          clientId: client.clientId,
          now: new Date(
            now.getTime() + OAUTH_REFRESH_INACTIVITY_TTL_SECONDS * 1000,
          ),
        },
        { clients: [client], store: staleMemory.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("validates refresh-token shape before storage lookup", async () => {
    const memory = memoryTokenStore();
    await expect(
      refreshOAuthAccessToken(
        { refreshToken: "plaintext-secret", clientId: client.clientId },
        { clients: [client], store: memory.store },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(memory.store.rotate).not.toHaveBeenCalled();

    const generated = generateOAuthRefreshToken();
    expect(generated).toMatch(/^wrt_[A-Za-z0-9_-]{43}$/);
    expect(hashOAuthRefreshToken(generated)).toMatch(/^[0-9a-f]{64}$/);
  });
});
