import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("account sign-in collision (local PostgreSQL)", () => {
  it("links atomically with one audit row and refuses competing ownership", async () => {
    const address = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)) throw new Error("Only local PostgreSQL is allowed");
    const { db } = await import("@/lib/db/client");
    const { users, userIdentities, actionAudit } = await import("@/lib/db/schema");
    const { linkIdentityToUser } = await import("@/lib/store");
    if (!db) throw new Error("Local database unavailable");
    const [owner] = await db.insert(users).values({ name:"Link audit fixture" }).returning({ id:users.id });
    const [other] = await db.insert(users).values({ name:"Other fixture" }).returning({ id:users.id });
    const subject = `google:${crypto.randomUUID()}`;
    try {
      const outcomes = await Promise.all(Array.from({ length: 32 }, () => linkIdentityToUser(owner.id, subject)));
      expect(outcomes.filter(result => result === "linked")).toHaveLength(1);
      expect(outcomes.filter(result => result === "already-yours")).toHaveLength(31);
      expect(await linkIdentityToUser(other.id,subject)).toBe("taken");
      const rows = await db.select().from(actionAudit).where(eq(actionAudit.actorUserId,owner.id));
      expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({actionName:"account.link_identity",targetId:owner.id,inputSummary:"google"});
      expect(JSON.stringify(rows)).not.toContain(subject);
    } finally {
      await db.delete(actionAudit).where(eq(actionAudit.actorUserId,owner.id));
      await db.delete(userIdentities).where(eq(userIdentities.subject,subject));
      await db.delete(users).where(eq(users.id,owner.id));await db.delete(users).where(eq(users.id,other.id));
    }
  });
  it("refuses a second subject for an occupied provider without claiming or moving it", async () => {
    const address = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)) throw new Error("Only local PostgreSQL is allowed");
    const { db } = await import("@/lib/db/client");
    const { users, userIdentities, actionAudit } = await import("@/lib/db/schema");
    const { linkIdentityToUser } = await import("@/lib/store");
    if (!db) throw new Error("Local database unavailable");
    const fixtures = await db.insert(users).values([{ name: "Provider slot fixture" }, { name: "Independent slot fixture" }]).returning({ id: users.id });
    const [owner, other] = fixtures;
    const subjects = [`google:${crypto.randomUUID()}`, `google:${crypto.randomUUID()}`];
    try {
      const results = await Promise.all(subjects.map(subject => linkIdentityToUser(owner.id, subject)));
      expect([...results].sort()).toEqual(["linked", "taken"]);
      const winner = subjects[results.indexOf("linked")], refused = subjects[results.indexOf("taken")];
      expect(await linkIdentityToUser(owner.id, refused)).toBe("taken");
      expect(await linkIdentityToUser(other.id, winner)).toBe("taken");
      expect(await linkIdentityToUser(other.id, refused)).toBe("linked");
      expect(await db.select({ userId: userIdentities.userId, subject: userIdentities.subject }).from(userIdentities).where(eq(userIdentities.userId, owner.id))).toEqual([{ userId: owner.id, subject: winner }]);
      for (const fixture of fixtures) expect(await db.select().from(actionAudit).where(eq(actionAudit.actorUserId, fixture.id))).toHaveLength(1);
    } finally {
      for (const fixture of fixtures) {
        await db.delete(actionAudit).where(eq(actionAudit.actorUserId, fixture.id));
        await db.delete(userIdentities).where(eq(userIdentities.userId, fixture.id));
        await db.delete(users).where(eq(users.id, fixture.id));
      }
    }
  });
  it("concurrent different users cannot share or transfer one subject", async () => {
    const address = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)) throw new Error("Only local PostgreSQL is allowed");
    const { db } = await import("@/lib/db/client");
    const { users, userIdentities, actionAudit } = await import("@/lib/db/schema");
    const { linkIdentityToUser } = await import("@/lib/store");
    if (!db) throw new Error("Local database unavailable");
    const fixtures = await db.insert(users).values([{ name: "Subject contender A" }, { name: "Subject contender B" }]).returning({ id: users.id });
    const subject = `github:${crypto.randomUUID()}`;
    try {
      const outcomes = await Promise.all(fixtures.map(fixture => linkIdentityToUser(fixture.id, subject)));
      expect([...outcomes].sort()).toEqual(["linked", "taken"]);
      const winner = fixtures[outcomes.indexOf("linked")], refused = fixtures[outcomes.indexOf("taken")];
      expect(await linkIdentityToUser(winner.id, subject)).toBe("already-yours");
      expect(await linkIdentityToUser(refused.id, subject)).toBe("taken");
      expect(await db.select({ userId: userIdentities.userId }).from(userIdentities).where(eq(userIdentities.subject, subject))).toEqual([{ userId: winner.id }]);
      for (const fixture of fixtures) expect(await db.select().from(actionAudit).where(eq(actionAudit.actorUserId, fixture.id))).toHaveLength(fixture.id === winner.id ? 1 : 0);
    } finally {
      await db.delete(userIdentities).where(eq(userIdentities.subject, subject));
      for (const fixture of fixtures) {
        await db.delete(actionAudit).where(eq(actionAudit.actorUserId, fixture.id));
        await db.delete(users).where(eq(users.id, fixture.id));
      }
    }
  });
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
