import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  generateApiToken,
  hashApiToken,
  parseBearerApiToken,
  resolveApiToken,
} from "@/lib/api-tokens";

describe("generateApiToken", () => {
  it("mints wsk_ tokens with 43 base64url chars", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateApiToken()).toMatch(/^wsk_[A-Za-z0-9_-]{43}$/);
    }
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateApiToken()));
    expect(seen.size).toBe(200);
  });
});

describe("hashApiToken", () => {
  const token = `wsk_${"a".repeat(43)}`;

  it("is deterministic sha256 hex", () => {
    expect(hashApiToken(token)).toBe(hashApiToken(token));
    expect(hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken(token)).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
  });

  it("differs for different tokens", () => {
    expect(hashApiToken(token)).not.toBe(hashApiToken(`wsk_${"b".repeat(43)}`));
  });
});

describe("parseBearerApiToken", () => {
  const token = generateApiToken();

  it("accepts a well-formed Bearer header", () => {
    expect(parseBearerApiToken(`Bearer ${token}`)).toBe(token);
  });

  it("accepts a case-insensitive scheme and stray whitespace", () => {
    expect(parseBearerApiToken(`bearer ${token}`)).toBe(token);
    expect(parseBearerApiToken(`BEARER  ${token}`)).toBe(token);
    expect(parseBearerApiToken(`  Bearer ${token}  `)).toBe(token);
  });

  it("rejects a missing header", () => {
    expect(parseBearerApiToken(null)).toBeNull();
    expect(parseBearerApiToken("")).toBeNull();
  });

  it("rejects other schemes and schemeless tokens", () => {
    expect(parseBearerApiToken(`Basic ${token}`)).toBeNull();
    expect(parseBearerApiToken(token)).toBeNull();
    expect(parseBearerApiToken(`Bearer${token}`)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(parseBearerApiToken("Bearer")).toBeNull();
    expect(parseBearerApiToken("Bearer ")).toBeNull();
    expect(parseBearerApiToken("Bearer wsk_short")).toBeNull();
    expect(parseBearerApiToken(`Bearer ${token} trailing`)).toBeNull();
    expect(parseBearerApiToken(`Bearer ${token}x`)).toBeNull();
    expect(
      parseBearerApiToken(`Bearer ${token.replace("wsk_", "abc_")}`),
    ).toBeNull();
    expect(parseBearerApiToken(`Bearer wsk_${"!".repeat(43)}`)).toBeNull();
  });
});

describe("resolveApiToken", () => {
  it("returns null for missing or malformed headers", async () => {
    expect(await resolveApiToken(null)).toBeNull();
    expect(await resolveApiToken("Basic abc")).toBeNull();
    expect(await resolveApiToken("Bearer nope")).toBeNull();
  });

  it("returns null for a well-formed token when no database is configured", async () => {
    // Tests run without DATABASE_URL, so the db client is null; a shapely
    // token must still resolve to null rather than throw.
    expect(await resolveApiToken(`Bearer ${generateApiToken()}`)).toBeNull();
  });
});
