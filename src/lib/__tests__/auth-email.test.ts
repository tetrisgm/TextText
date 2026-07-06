// The email-adapter contracts that keep identity stable across providers.
// DB-free by repo convention: the db client is mocked with a fake that
// records the drizzle calls, and where-clauses are decompiled to SQL via
// PgDialect so the tests assert the REAL filter parameters (the sub scheme),
// not just return shapes.
//
// The two contracts everything else leans on:
// 1. Subs never collide: apple stays raw, google/email/dev are prefixed, and
//    every lookup filters users.apple_sub by exactly that sub.
// 2. getUserByAccount never returns null and getUser always does, so OAuth
//    sign-ins never enter Auth.js's adapter create/link path and a fresh
//    sign-in replaces the session exactly like the adapterless flow.

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { users, verificationTokens } from "@/lib/db/schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db/client", () => ({
  get db() {
    return holder.db;
  },
}));

const { createAuthAdapter, emailSub } = await import("@/lib/auth-email");

const dialect = new PgDialect();

function params(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as SQL).params;
}

type Call = Record<string, unknown>;

interface FakeState {
  selectRows: Array<Array<Record<string, unknown>>>;
  deleteRows: Array<Array<Record<string, unknown>>>;
}

function createFakeDb(state: FakeState) {
  const calls: { selects: Call[]; inserts: Call[]; deletes: Call[] } = {
    selects: [],
    inserts: [],
    deletes: [],
  };
  const db = {
    select(fields: unknown) {
      return {
        from(table: unknown) {
          return {
            where(cond: unknown) {
              return {
                limit(limit: number) {
                  calls.selects.push({ fields, table, cond, limit });
                  return Promise.resolve(state.selectRows.shift() ?? []);
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: unknown) {
          const record: Call = { table, values, conflictTarget: undefined };
          calls.inserts.push(record);
          return {
            onConflictDoNothing(config: { target: unknown }) {
              record.conflictTarget = config.target;
              return Promise.resolve();
            },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve().then(() => resolve(undefined));
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(cond: unknown) {
          calls.deletes.push({ table, cond });
          const rows = state.deleteRows.shift() ?? [];
          return {
            returning() {
              return Promise.resolve(rows);
            },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve().then(() => resolve(rows));
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

function setup(state?: Partial<FakeState>) {
  const fake = createFakeDb({
    selectRows: state?.selectRows ?? [],
    deleteRows: state?.deleteRows ?? [],
  });
  holder.db = fake.db;
  const adapter = createAuthAdapter();
  if (!adapter) throw new Error("adapter should exist with a db");
  return { adapter, calls: fake.calls };
}

beforeEach(() => {
  holder.db = null;
});

describe("createAuthAdapter gating", () => {
  it("returns undefined without a database", () => {
    expect(createAuthAdapter()).toBeUndefined();
  });
});

describe("emailSub", () => {
  it("normalizes case and whitespace into a stable sub", () => {
    expect(emailSub("  Person@Example.COM ")).toBe("email:person@example.com");
  });
});

describe("getUserByEmail", () => {
  it("filters by the email: sub only, never a raw address", async () => {
    const { adapter, calls } = setup({ selectRows: [[]] });
    const result = await adapter.getUserByEmail!("Person@Example.com");
    expect(result).toBeNull();
    expect(params(calls.selects[0].cond)).toEqual([
      "email:person@example.com",
    ]);
    expect(calls.selects[0].table).toBe(users);
  });

  it("maps a stored row onto the adapter user", async () => {
    const { adapter } = setup({
      selectRows: [
        [{ appleSub: "email:p@example.com", email: "p@example.com", name: "P" }],
      ],
    });
    const result = await adapter.getUserByEmail!("p@example.com");
    expect(result).toEqual({
      id: "email:p@example.com",
      email: "p@example.com",
      emailVerified: null,
      name: "P",
    });
  });
});

describe("getUserByAccount", () => {
  it("keeps Apple subs raw so existing users stay keyed", async () => {
    const { adapter, calls } = setup({ selectRows: [[]] });
    await adapter.getUserByAccount!({
      provider: "apple",
      providerAccountId: "000123.abcdef.0456",
    });
    expect(params(calls.selects[0].cond)).toEqual(["000123.abcdef.0456"]);
  });

  it("namespaces Google subs", async () => {
    const { adapter, calls } = setup({ selectRows: [[]] });
    await adapter.getUserByAccount!({
      provider: "google",
      providerAccountId: "g-12345",
    });
    expect(params(calls.selects[0].cond)).toEqual(["google:g-12345"]);
  });

  it("NEVER returns null: unknown accounts get a stub keyed by the sub", async () => {
    const { adapter, calls } = setup({ selectRows: [[]] });
    const result = await adapter.getUserByAccount!({
      provider: "google",
      providerAccountId: "g-new",
    });
    expect(result).toEqual({ id: "google:g-new", email: "", emailVerified: null });
    // A stub is a read-only outcome: nothing was written.
    expect(calls.inserts).toHaveLength(0);
    expect(calls.deletes).toHaveLength(0);
  });

  it("returns the stored row when the user exists", async () => {
    const { adapter } = setup({
      selectRows: [
        [{ appleSub: "google:g-1", email: "g@example.com", name: "G" }],
      ],
    });
    const result = await adapter.getUserByAccount!({
      provider: "google",
      providerAccountId: "g-1",
    });
    expect(result?.id).toBe("google:g-1");
    expect(result?.name).toBe("G");
  });
});

describe("getUser", () => {
  it("always returns null so a fresh sign-in replaces the session", async () => {
    const { adapter, calls } = setup();
    expect(await adapter.getUser!("dev:someone@example.com")).toBeNull();
    expect(calls.selects).toHaveLength(0);
  });
});

describe("createUser", () => {
  it("inserts the users row keyed by the email sub, tolerating races", async () => {
    const { adapter, calls } = setup();
    const result = await adapter.createUser!({
      id: "ignored-random-uuid",
      email: "New@Example.com",
      emailVerified: null,
      name: null,
    });
    expect(result.id).toBe("email:new@example.com");
    expect(calls.inserts[0].table).toBe(users);
    expect(calls.inserts[0].values).toMatchObject({
      appleSub: "email:new@example.com",
      email: "new@example.com",
    });
    expect(calls.inserts[0].conflictTarget).toBe(users.appleSub);
  });

  it("refuses a user without an email address", async () => {
    const { adapter } = setup();
    await expect(
      adapter.createUser!({
        id: "x",
        email: "",
        emailVerified: null,
      }),
    ).rejects.toThrow(/email/i);
  });
});

describe("updateUser", () => {
  it("echoes the stored row and never writes (JWT sessions)", async () => {
    const { adapter, calls } = setup({
      selectRows: [
        [{ appleSub: "email:p@example.com", email: "p@example.com", name: "P" }],
      ],
    });
    const stamp = new Date();
    const result = await adapter.updateUser!({
      id: "email:p@example.com",
      emailVerified: stamp,
    });
    expect(result).toEqual({
      id: "email:p@example.com",
      email: "p@example.com",
      emailVerified: stamp,
      name: "P",
    });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.deletes).toHaveLength(0);
  });
});

describe("verification tokens", () => {
  it("createVerificationToken purges expired rows, then inserts", async () => {
    const { adapter, calls } = setup();
    const token = {
      identifier: "p@example.com",
      token: "hashed-token",
      expires: new Date(Date.now() + 60_000),
    };
    const result = await adapter.createVerificationToken!(token);
    expect(result).toEqual(token);
    expect(calls.deletes[0].table).toBe(verificationTokens);
    // The purge condition compares expires against "now", nothing else.
    const purgeParams = params(calls.deletes[0].cond);
    expect(purgeParams).toHaveLength(1);
    const cutoff = new Date(purgeParams[0] as string).getTime();
    expect(Math.abs(cutoff - Date.now())).toBeLessThan(60_000);
    expect(calls.inserts[0].table).toBe(verificationTokens);
    expect(calls.inserts[0].values).toEqual(token);
  });

  it("useVerificationToken consumes by identifier + token and returns the row", async () => {
    const row = {
      identifier: "p@example.com",
      token: "hashed-token",
      expires: new Date(),
    };
    const { adapter, calls } = setup({ deleteRows: [[row]] });
    const result = await adapter.useVerificationToken!({
      identifier: "p@example.com",
      token: "hashed-token",
    });
    expect(result).toEqual(row);
    expect(calls.deletes[0].table).toBe(verificationTokens);
    expect(params(calls.deletes[0].cond)).toEqual([
      "p@example.com",
      "hashed-token",
    ]);
  });

  it("useVerificationToken returns null when the row is gone (single-use)", async () => {
    const { adapter } = setup({ deleteRows: [[]] });
    expect(
      await adapter.useVerificationToken!({
        identifier: "p@example.com",
        token: "already-used",
      }),
    ).toBeNull();
  });
});
