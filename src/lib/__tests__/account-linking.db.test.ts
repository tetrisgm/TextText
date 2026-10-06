import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("account sign-in collision (local PostgreSQL)", () => {
  it("preserves the existing account when another provider has the same email", async () => {
    const address = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)) {
      throw new Error("Only local PostgreSQL is allowed");
    }
    const { db } = await import("@/lib/db/client");
    const { users } = await import("@/lib/db/schema");
    const { createAuthAdapter } = await import("@/lib/auth-email");
    const { AccountLinkRequiredError, ensureOwnerBlog } = await import("@/lib/store");
    if (!db) throw new Error("Local database unavailable");

    const suffix = crypto.randomUUID();
    const email = `link-${suffix}@example.invalid`;
    const [existing] = await db.insert(users).values({
      appleSub: `apple-${suffix}`,
      email,
      name: "Existing account",
    }).returning({ id: users.id });
    try {
      await expect(ensureOwnerBlog({
        sub: `google:${suffix}`,
        email: email.toUpperCase(),
        name: "Different provider",
      })).rejects.toBeInstanceOf(AccountLinkRequiredError);
      const adapter = createAuthAdapter();
      if (!adapter?.createUser) throw new Error("Email adapter unavailable");
      await expect(adapter.createUser({
        id: "unused",
        email: email.toUpperCase(),
        emailVerified: new Date(),
      })).rejects.toBeInstanceOf(AccountLinkRequiredError);
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      expect(rows).toEqual([{ id: existing.id }]);
    } finally {
      await db.delete(users).where(eq(users.id, existing.id));
    }
  });
});
