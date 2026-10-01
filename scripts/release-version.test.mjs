import { test } from "node:test";
import assert from "node:assert/strict";
import { assertVersionFree, nextVersion } from "./release-version.mjs";

const publicBase = "https://downloads.example";

test("release preflight checks immutable files at the configured public origin", async () => {
  const checked = [];
  await assertVersionFree("0.203", publicBase, async (url, options) => {
    checked.push(url);
    assert.equal(options.method, "HEAD");
    assert.equal(options.redirect, "error");
    return { status: 404 };
  });
  assert.deepEqual(checked, [
    `${publicBase}/downloads/TextText-0.203.zip`,
    `${publicBase}/downloads/appcast-0.203.xml`,
  ]);
});

test("release preflight refuses missing or obsolete origins before any request", async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return { status: 404 }; };
  await assert.rejects(assertVersionFree("0.203", undefined, fetcher), /TEXTTEXT_RELEASE_PUBLIC_BASE/);
  await assert.rejects(assertVersionFree("0.203", "https://old.public.blob.vercel-storage.com", fetcher), /public HTTPS download origin/);
  await assert.rejects(assertVersionFree("0.203", "https://downloads.example/path", fetcher), /public HTTPS download origin/);
  assert.equal(requests, 0);
});

test("next version skips occupied versions on the configured public origin", async () => {
  const checked = [];
  const version = await nextVersion({ publicBase, versions: ["0.202", "0.201"], fetcher: async (url) => {
    checked.push(url);
    return { status: url.includes("0.203") ? 200 : 404 };
  } });
  assert.equal(version, "0.204");
  assert.equal(checked.length, 4);
  assert.ok(checked.every(url => url.startsWith(`${publicBase}/downloads/`)));
});

test("local version calculation does not need release storage", async () => {
  const version = await nextVersion({ publicBase: null, versions: ["0.202", "0.210"], fetcher: () => {
    throw new Error("Local version calculation must not make a request");
  } });
  assert.equal(version, "0.211");
});
