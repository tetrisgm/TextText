import { expect, it } from "vitest";
import { VaultError, type VaultFile, type vaultRequest } from "./bridge";
import { HandoffNotOpenedError, openLocalSharedSession } from "./shared-open";

const itemId = "5076e549-e50a-4996-9fac-29dabf007929";
const file = (hash: string, id = itemId): VaultFile => ({
  path: "Notes/Test.textpack", hash,
  markdown: `---\ntextTextId: "${id}"\ntextTextKind: "note"\n---\n\nTest\n`,
});

it("joins the updated same-identity file after sync wins the read/open race", async () => {
  const calls: string[] = [];
  const request = (async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push(`${method}:${params.hash ?? params.path}`);
    if (method === "read") return file("new") as T;
    if (params.hash === "old") throw new VaultError("changed", "local_changed");
    return { sessionToken: "session", path: file("new").path, hash: "new" } as T;
  }) as typeof vaultRequest;
  const opened = await openLocalSharedSession(itemId, file("old"), request);
  expect(opened.file.hash).toBe("new");
  expect(opened.native.sessionToken).toBe("session");
  expect(calls).toEqual(["collaborationOpen:old", "read:Notes/Test.textpack", "collaborationOpen:new"]);
});

it("does not join another item or loop on an unchanged file", async () => {
  for (const fresh of [file("new", "different"), file("old")]) {
    let opens = 0;
    const request = (async <T,>(method: string): Promise<T> => {
      if (method === "read") return fresh as T;
      opens++;
      throw new VaultError("changed", "local_changed");
    }) as typeof vaultRequest;
    await expect(openLocalSharedSession(itemId, file("old"), request, 0)).rejects.toMatchObject({ code: "local_changed" });
    expect(opens).toBeLessThanOrEqual(5);
  }
});

it("retries a native baseline race even when the file bytes are unchanged", async () => {
  let opens = 0;
  const request = (async <T,>(method: string): Promise<T> => {
    if (method === "read") return file("old") as T;
    if (++opens === 1) throw new VaultError("native baseline pending", "local_changed");
    return { sessionToken: "session", path: file("old").path, hash: "old" } as T;
  }) as typeof vaultRequest;
  expect((await openLocalSharedSession(itemId, file("old"), request)).native.sessionToken).toBe("session");
  expect(opens).toBe(2);
});

it("requires the actual private profile proof after a requested native handoff open", async () => {
  for (const proof of [undefined, { version: 1, profileVersion: 3 }, { version: 2, profileVersion: 4 }, { version: 1, profileVersion: 4, extra: true }]) {
    let calls = 0;
    const request = (async <T,>(_method: string, params: Record<string, unknown>): Promise<T> => { calls++; expect(params.localHandoffVersion).toBe(1); return { localHandoff: proof, sessionToken: "possible-acquired-lease", path: file("old").path, hash: "old" } as T; }) as typeof vaultRequest;
    await expect(openLocalSharedSession(itemId, file("old"), request, 0, { version: 1, profileVersion: 4 })).rejects.toMatchObject({ code: "handoff_unverified" });
    expect(calls).toBe(1); // No legacy fallback, close or second lease after an uncertain open.
  }
  const request = (async <T,>(): Promise<T> => ({ localHandoff: { version: 1, profileVersion: 4 }, sessionToken: "verified", path: file("old").path, hash: "old" }) as T) as typeof vaultRequest;
  expect((await openLocalSharedSession(itemId, file("old"), request, 0, { version: 1, profileVersion: 4 })).native.sessionToken).toBe("verified");
});
it("does not request a new profile for ordinary legacy opens", async () => {
  const request = (async <T,>(_method: string, params: Record<string, unknown>): Promise<T> => { expect(params).not.toHaveProperty("localHandoffVersion"); return { sessionToken: "legacy", path: file("old").path, hash: "old" } as T; }) as typeof vaultRequest;
  expect((await openLocalSharedSession(itemId, file("old"), request)).native.sessionToken).toBe("legacy");
});

it("retries only certified prepublication failures of a verified handoff", async () => {
  let opens = 0;
  const request = (async <T,>(): Promise<T> => {
    if (++opens === 1) throw new VaultError("certified", "handoff_not_open");
    return { localHandoff: { version: 1, profileVersion: 4 }, sessionToken: "verified", path: file("old").path, hash: "old" } as T;
  }) as typeof vaultRequest;
  expect((await openLocalSharedSession(itemId, file("old"), request, 0, { version: 1, profileVersion: 4 })).native.sessionToken).toBe("verified");
  expect(opens).toBe(2);
});
it("retains exact scoped certification after the bounded retry deadline", async () => {
  let calls = 0;
  const request = (async () => { calls++; throw new VaultError("certified", "handoff_not_open"); }) as typeof vaultRequest;
  const error = await openLocalSharedSession(itemId, file("old"), request, 0, { version: 1, profileVersion: 4 }, 0).catch(error => error);
  expect(error).toBeInstanceOf(HandoffNotOpenedError); expect(error.matches(itemId, file("old"))).toBe(true);
  expect(error.matches(itemId, file("new"))).toBe(false); expect(calls).toBe(1);
});
it("never certifies generic, unknown, account or unrequested native errors", async () => {
  for (const code of ["503", "profile_busy", "account_changed", "epoch_changed", "handoff_unverified", "handoff_not_open"]) {
    let calls = 0;
    const request = (async () => { calls++; throw new VaultError("refused", code); }) as typeof vaultRequest;
    const error = await openLocalSharedSession(itemId, file("old"), request, 0, code === "handoff_not_open" ? undefined : { version: 1, profileVersion: 4 }, 0).catch(error => error);
    expect(error).not.toBeInstanceOf(HandoffNotOpenedError); expect(calls).toBe(1);
  }
});
it("stops certified retry when the captured owner changes", async () => {
  let current = true, calls = 0;
  const request = (async () => { calls++; current = false; throw new VaultError("certified", "handoff_not_open"); }) as typeof vaultRequest;
  await expect(openLocalSharedSession(itemId, file("old"), request, 0, { version: 1, profileVersion: 4 }, 1000,
    () => { if (!current) throw Error("owner changed"); })).rejects.toThrow("owner changed");
  expect(calls).toBe(1);
});
it("does not reuse an earlier certificate after a later uncertain reply", async () => {
  let calls = 0;
  const request = (async () => { throw new VaultError("controlled", ++calls === 1 ? "handoff_not_open" : "503"); }) as typeof vaultRequest;
  const error = await openLocalSharedSession(itemId, file("old"), request, 0, { version: 1, profileVersion: 4 }).catch(error => error);
  expect(calls).toBe(2); expect(error).not.toBeInstanceOf(HandoffNotOpenedError); expect(error.code).toBe("503");
});
