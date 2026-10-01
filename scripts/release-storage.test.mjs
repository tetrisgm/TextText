import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { releaseStorageConfig, inspectReleaseFile, uploadReleaseFile, inspectAppcast, verifyPublicArtifact } from "./release-storage.mjs";
const environment = { TEXTTEXT_R2_ACCOUNT_ID: "a".repeat(32), TEXTTEXT_RELEASE_R2_ACCESS_KEY_ID: "test", TEXTTEXT_RELEASE_R2_SECRET_ACCESS_KEY: "test", TEXTTEXT_RELEASE_PUBLIC_BASE: "https://downloads.example" };
test("release storage requires explicit public origin and separate credentials", () => {
  assert.equal(releaseStorageConfig(environment).bucket, "texttext-releases");
  for (const bad of [undefined, "http://downloads.example", "https://user:password@downloads.example", "https://old.public.blob.vercel-storage.com", `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, "https://downloads.example/path", "https://downloads.example?x=1"]) assert.throws(() => releaseStorageConfig({ ...environment, TEXTTEXT_RELEASE_PUBLIC_BASE: bad }));
  assert.throws(() => releaseStorageConfig({ ...environment, TEXTTEXT_RELEASE_R2_SECRET_ACCESS_KEY: undefined, TEXTTEXT_R2_SECRET_ACCESS_KEY: "backup-is-not-a-release-key" }));
  assert.throws(() => releaseStorageConfig({ ...environment, TEXTTEXT_RELEASE_R2_BUCKET: "texttext-media" }));
});
test("appcast identity, immutable enclosure and signature are checked before upload", () => {
  const url = "https://downloads.example/downloads/TextText-1.2.zip";
  const xml = `<sparkle:version>1200</sparkle:version><sparkle:shortVersionString>1.2</sparkle:shortVersionString><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements><enclosure url="${url}" length="4" sparkle:edSignature="${"a".repeat(86)}==" />`;
  assert.equal(inspectAppcast(xml, "1.2", url, 4), 1200);
  assert.throws(() => inspectAppcast(xml, "1.3", url, 4));
  assert.throws(() => inspectAppcast(xml, "1.2", url, 5));
  assert.throws(() => inspectAppcast(xml.replace("arm64", "x86_64"), "1.2", url, 4));
  assert.throws(() => inspectAppcast(xml.replace(url, "https://evil.example/file.zip"), "1.2", url, 4));
  assert.throws(() => inspectAppcast(xml.replace("edSignature", "unsigned"), "1.2", url, 4));
});
test("immutable upload retries identical bytes but refuses changed objects", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "texttext-release-test-"));
  try {
    const file = path.join(directory, "file.zip"); await writeFile(file, "test");
    const identity = await inspectReleaseFile(file); assert.equal(identity.length, 4);
    const commands = [], config = releaseStorageConfig(environment);
    const client = { async send(command) { commands.push(command); if (command.constructor.name === "PutObjectCommand") throw { $metadata: { httpStatusCode: 412 } }; return { ContentLength: 4, Metadata: { sha256: identity.sha256 } }; } };
    await uploadReleaseFile(client, config, "downloads/TextText-1.2.zip", file, "application/zip", identity);
    assert.equal(commands[0].input.IfNoneMatch, "*"); assert.equal(commands[0].input.Metadata.sha256, identity.sha256);
    await assert.rejects(uploadReleaseFile(client, config, "downloads/TextText-1.2.zip", file, "application/zip", { ...identity, sha256: "different" }), /different bytes/);
    await assert.rejects(uploadReleaseFile(client, config, "downloads/TextText.zip", file, "application/zip", identity), /immutable release key/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("public artifact identity is required before switching the marker", async () => {
  const identity = { length: 4, sha256: createHash("sha256").update("test").digest("hex") };
  const ok = async (_url, options) => { assert.equal(options.redirect, "error"); return new Response("test"); };
  await verifyPublicArtifact("https://downloads.example/file.zip", identity, ok);
  await assert.rejects(verifyPublicArtifact("https://downloads.example/file.zip", { ...identity, length: 5 }, ok));
  await assert.rejects(verifyPublicArtifact("https://downloads.example/file.zip", { ...identity, sha256: "different" }, ok));
  await assert.rejects(verifyPublicArtifact("https://downloads.example/file.zip", identity, async () => new Response(null, { status: 404 })));
});
