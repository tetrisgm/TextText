import { expect, it } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureVaultFolders, listVaultTextpacks } from "./store";

it("rejects the entire nonportable folder batch before provisioning any directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folder-portability-"));
  for (const folder of ["Trailing ", "Nested/CON", "Nested/Trailing.", "Nested/bad:name"]) {
    await expect(ensureVaultFolders({ root, workspaceId: "portable-test" }, ["Valid", folder])).rejects.toThrow("portable folder path");
    expect(await fs.readdir(root)).toEqual([]);
  }
});

it("provisions portable Unicode folders with their exact catalog names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folder-portability-"));
  const context = { root, workspaceId: "portable-test" };
  await ensureVaultFolders(context, ["日本語/Notes", "Café"]);
  expect((await listVaultTextpacks(context)).folders).toEqual(["Café", "日本語", "日本語/Notes"]);
});
