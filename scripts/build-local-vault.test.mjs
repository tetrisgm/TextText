import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isBuildLocalVaultEntrypoint } from "./build-local-vault.mjs";

const entry = fileURLToPath(new URL("./build-local-vault.mjs", import.meta.url));

test("recognizes the builder through a temporary symlink alias", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "texttext-local-vault-entrypoint-"));
  const alias = path.join(temporary, "build-local-vault.mjs");
  try {
    symlinkSync(entry, alias);
    assert.notEqual(path.resolve(alias), path.resolve(entry));
    assert.equal(realpathSync(alias), realpathSync(entry));
    assert.equal(isBuildLocalVaultEntrypoint(alias, pathToFileURL(entry).href), true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("does not run for missing, unrelated, or nonexistent invocation paths", () => {
  assert.equal(isBuildLocalVaultEntrypoint(undefined, import.meta.url), false);
  assert.equal(isBuildLocalVaultEntrypoint(path.join(os.tmpdir(), "other.mjs"), import.meta.url), false);
});
