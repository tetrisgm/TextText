import { describe, expect, it, vi } from "vitest";
import {
  type OAuthAuthorizationCodeRecord,
  type OAuthAuthorizationCodeStore,
  type OAuthClient,
  exchangeOAuthAuthorizationCode,
  hashOAuthAuthorizationCode,
  issueOAuthAuthorizationCode,
  pkceS256Challenge,
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
        rows.set(input.codeHash, {
          codeHash: input.codeHash,
          userId: input.userId,
          clientId: input.clientId,
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          scope: input.scope,
          expiresAt: input.expiresAt,
          consumedAt: null,
        });
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

  it("stores only a hash of the raw code and exchanges it once", async () => {
    const { store, rows } = memoryCodeStore();
    const mintToken = vi.fn(async () => ({ raw: `wsk_${"a".repeat(43)}` }));
    const issued = await issueOAuthAuthorizationCode(
      {
        userId: "user-1",
        clientId: client.clientId,
        redirectUri,
        codeChallenge: pkceS256Challenge(verifier),
      },
      store,
    );

    expect(rows.has(hashOAuthAuthorizationCode(issued.code))).toBe(true);
    expect([...rows.keys()]).not.toContain(issued.code);

    await expect(
      exchangeOAuthAuthorizationCode(
        {
          code: issued.code,
          clientId: client.clientId,
          redirectUri,
          codeVerifier: verifier,
        },
        { clients: [client], store, mintToken },
      ),
    ).resolves.toEqual({
      access_token: `wsk_${"a".repeat(43)}`,
      token_type: "Bearer",
      scope: "sync",
    });

    await expect(
      exchangeOAuthAuthorizationCode(
        {
          code: issued.code,
          clientId: client.clientId,
          redirectUri,
          codeVerifier: verifier,
        },
        { clients: [client], store, mintToken },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(mintToken).toHaveBeenCalledTimes(1);
    expect(mintToken).toHaveBeenCalledWith("user-1", "OAuth: Connector");
  });

  it("binds the code to the exact redirect_uri", async () => {
    const { store } = memoryCodeStore();
    const mintToken = vi.fn(async () => ({ raw: `wsk_${"b".repeat(43)}` }));
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
        { clients: [client], store, mintToken },
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
        { clients: [client], store, mintToken },
      ),
    ).resolves.toMatchObject({ token_type: "Bearer", scope: "sync" });
  });

  it("burns the code on a failed PKCE verifier", async () => {
    const { store } = memoryCodeStore();
    const mintToken = vi.fn(async () => ({ raw: `wsk_${"c".repeat(43)}` }));
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
        { clients: [client], store, mintToken },
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
        { clients: [client], store, mintToken },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(mintToken).not.toHaveBeenCalled();
  });
});
