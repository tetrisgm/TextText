import { expect, it } from "vitest";
import { VaultError, type VaultFile, type vaultRequest } from "./bridge";
import { openLocalSharedSession } from "./shared-open";

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
    await expect(openLocalSharedSession(itemId, file("old"), request)).rejects.toMatchObject({ code: "local_changed" });
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
