import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  inspectAppcast,
  inspectReleaseFile,
  releaseStorageConfig,
  uploadReleaseFile,
  verifyPublicArtifact,
} from "./release-storage.mjs";
import {
  installReleaseArtifact,
  prepareReleaseArtifact,
  runInstallerCommand,
  validateArtifactRoot,
} from "./install-release-artifact.mjs";

const environment = {
  TEXTTEXT_ORACLE_HOST: "ubuntu@oracle.example",
  TEXTTEXT_PRODUCT_ORIGIN: "https://texttext.example",
};

test("release storage uses the product origin and existing Oracle SSH identity", () => {
  const config = releaseStorageConfig(environment, { home: "/Users/test" });
  assert.equal(config.base, "https://texttext.example");
  assert.equal(config.artifactRoot, "/home/ubuntu/texttext/release-artifacts");
  assert.equal(config.minFreeBytes, 2 * 1024 * 1024 * 1024);
  assert.deepEqual(config.sshOptions.slice(0, 2), ["-i", "/Users/test/.ssh/id_ed25519"]);
  assert.throws(() => releaseStorageConfig({ ...environment, TEXTTEXT_ORACLE_HOST: "bad host" }));
  assert.throws(() => releaseStorageConfig({ ...environment, TEXTTEXT_ORACLE_ROOT: "/tmp/texttext" }));
  assert.throws(() => releaseStorageConfig({ ...environment, TEXTTEXT_STORAGE_MIN_FREE_BYTES: "-1" }));
  for (const origin of [undefined, "http://texttext.example", "https://old.public.blob.vercel-storage.com", "https://texttext.example/path"]) {
    assert.throws(() => releaseStorageConfig({ ...environment, TEXTTEXT_PRODUCT_ORIGIN: origin }));
  }
});

test("appcast identity, immutable enclosure and signature are checked before transfer", () => {
  const url = "https://texttext.example/downloads/TextText-1.2.zip";
  const xml = `<sparkle:version>1200</sparkle:version><sparkle:shortVersionString>1.2</sparkle:shortVersionString><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements><enclosure url="${url}" length="4" sparkle:edSignature="${"a".repeat(86)}==" />`;
  assert.equal(inspectAppcast(xml, "1.2", url, 4), 1200);
  assert.throws(() => inspectAppcast(xml, "1.3", url, 4));
  assert.throws(() => inspectAppcast(xml, "1.2", url, 5));
  assert.throws(() => inspectAppcast(xml.replace("arm64", "x86_64"), "1.2", url, 4));
  assert.throws(() => inspectAppcast(xml.replace(url, "https://evil.example/file.zip"), "1.2", url, 4));
  assert.throws(() => inspectAppcast(xml.replace("edSignature", "unsigned"), "1.2", url, 4));
});

test("publisher prepares, copies, and installs through the existing SSH identity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "texttext-release-publisher-"));
  try {
    const file = path.join(directory, "TextText-1.2.zip");
    await writeFile(file, "test");
    const identity = await inspectReleaseFile(file);
    const config = releaseStorageConfig(environment, { home: "/Users/test" });
    const calls = [];
    const run = (command, args, options = {}) => { calls.push({ command, args, options }); return ""; };
    await uploadReleaseFile(config, "downloads/TextText-1.2.zip", file, "application/zip", identity, {
      run,
      token: "0123456789abcdef",
    });
    assert.deepEqual(calls.map(({ command }) => command), ["ssh", "scp", "ssh"]);
    assert.ok(calls[0].args.includes("prepare"));
    assert.ok(calls[0].args.includes("/home/ubuntu/texttext/release-artifacts"));
    assert.match(calls[0].options.input, /installReleaseArtifact/);
    assert.equal(calls[1].args.at(-2), file);
    assert.equal(calls[1].args.at(-1), "ubuntu@oracle.example:/home/ubuntu/texttext/release-artifacts/.incoming-TextText-1.2.zip-0123456789abcdef.tmp");
    assert.ok(calls[2].args.includes("install"));
    assert.ok(calls[2].args.includes(identity.sha256));
    assert.doesNotMatch(JSON.stringify(calls), /R2|credential|secret/i);
    await assert.rejects(
      uploadReleaseFile(config, "downloads/TextText.zip", file, "application/zip", identity, { run, token: "0123456789abcdef" }),
      /immutable release key/,
    );
    await assert.rejects(
      uploadReleaseFile(config, "downloads/TextText-1.2.zip", file, "text/html", identity, { run, token: "0123456789abcdef" }),
      /content type/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("publisher discards its private temporary after transfer failure", async () => {
  const config = releaseStorageConfig(environment, { home: "/Users/test" });
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === "scp") throw new Error("copy failed");
    return "";
  };
  await assert.rejects(
    uploadReleaseFile(config, "downloads/appcast-1.2.xml", "/tmp/appcast.xml", "application/xml; charset=utf-8", {
      length: 4,
      sha256: "a".repeat(64),
    }, { run, token: "fedcba9876543210" }),
    /copy failed/,
  );
  assert.deepEqual(calls.map(({ command }) => command), ["ssh", "scp", "ssh"]);
  assert.ok(calls[2].args.includes("discard"));
});

test("server installer is atomic, idempotent, and refuses differing existing bytes", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "texttext-release-installer-"));
  const root = path.join(parent, "release-artifacts");
  const filename = "TextText-1.2.zip";
  const identity = { length: 4, sha256: createHash("sha256").update("test").digest("hex") };
  try {
    const first = path.join(root, `.incoming-${filename}-0123456789abcdef.tmp`);
    await prepareReleaseArtifact(root, first, { length: 4, minFreeBytes: 0 });
    await writeFile(first, "test");
    assert.deepEqual(await installReleaseArtifact({ root, temporary: first, filename, ...identity, minFreeBytes: 0 }), { created: true, ...identity });
    assert.equal(await readFile(path.join(root, filename), "utf8"), "test");

    const retry = path.join(root, `.incoming-${filename}-1111111111111111.tmp`);
    await prepareReleaseArtifact(root, retry, { length: 4, minFreeBytes: 0 });
    await writeFile(retry, "test");
    assert.deepEqual(await installReleaseArtifact({ root, temporary: retry, filename, ...identity, minFreeBytes: 0 }), { created: false, ...identity });

    const changed = path.join(root, `.incoming-${filename}-2222222222222222.tmp`);
    await prepareReleaseArtifact(root, changed, { length: 4, minFreeBytes: 0 });
    await writeFile(changed, "evil");
    await assert.rejects(installReleaseArtifact({
      root,
      temporary: changed,
      filename,
      length: 4,
      sha256: createHash("sha256").update("evil").digest("hex"),
      minFreeBytes: 0,
    }), /different bytes/);
    assert.equal(await readFile(path.join(root, filename), "utf8"), "test");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("installer rejects deployment roots and checksum mismatches", async () => {
  assert.throws(() => validateArtifactRoot("/home/ubuntu/texttext/releases/release-artifacts"), /outside/);
  assert.throws(() => validateArtifactRoot("/tmp/release-artifacts", { production: true }), /under \/home\/ubuntu/);
  const parent = await mkdtemp(path.join(tmpdir(), "texttext-release-mismatch-"));
  const root = path.join(parent, "release-artifacts");
  const filename = "appcast-1.2.xml";
  const temporary = path.join(root, `.incoming-${filename}-3333333333333333.tmp`);
  try {
    await assert.rejects(prepareReleaseArtifact(root, temporary, {
      length: 4,
      minFreeBytes: 100,
      statfsImpl: async () => ({ bavail: 50n, bsize: 1n }),
    }), /enough free storage/);
    await prepareReleaseArtifact(root, temporary, { length: 4, minFreeBytes: 0 });
    await writeFile(temporary, "test");
    await assert.rejects(installReleaseArtifact({ root, temporary, filename, length: 4, sha256: "a".repeat(64), minFreeBytes: 0 }), /server verification/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the streamed installer CLI preserves prepare and install argument order", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "texttext-release-cli-"));
  const root = path.join(parent, "release-artifacts");
  const filename = "appcast-1.2.xml";
  const temporary = path.join(root, `.incoming-${filename}-4444444444444444.tmp`);
  const sha256 = createHash("sha256").update("test").digest("hex");
  try {
    await runInstallerCommand(["prepare", root, temporary, "4", "0"], { production: false });
    await writeFile(temporary, "test");
    assert.equal(
      await runInstallerCommand(["install", root, temporary, filename, "4", sha256, "0"], { production: false }),
      `installed ${filename}\n`,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("public artifact identity is required before switching the marker", async () => {
  const identity = { length: 4, sha256: createHash("sha256").update("test").digest("hex") };
  const ok = async (_url, options) => { assert.equal(options.redirect, "error"); return new Response("test"); };
  await verifyPublicArtifact("https://texttext.example/downloads/TextText-1.2.zip", identity, ok);
  await assert.rejects(verifyPublicArtifact("https://texttext.example/file.zip", { ...identity, length: 5 }, ok));
  await assert.rejects(verifyPublicArtifact("https://texttext.example/file.zip", { ...identity, sha256: "different" }, ok));
  await assert.rejects(verifyPublicArtifact("https://texttext.example/file.zip", identity, async () => new Response(null, { status: 404 })));
});
