import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

import {
  parseReleaseRange,
  releaseArtifactForFilename,
  serveReleaseDownload,
} from "@/lib/release-download.server";

const temporaryParents: string[] = [];

async function fixtureRoot() {
  const parent = await mkdtemp(path.join(tmpdir(), "texttext-release-route-"));
  temporaryParents.push(parent);
  const root = path.join(parent, "release-artifacts");
  await mkdir(root, { mode: 0o700 });
  await writeFile(path.join(root, "TextText-1.2.zip"), new Uint8Array([0, 1, 2, 3, 4]));
  await writeFile(path.join(root, "appcast-1.2.xml"), "<rss />");
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryParents.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Oracle-local release downloads", () => {
  it("allows only the two immutable filename forms", () => {
    expect(releaseArtifactForFilename("TextText-0.203.zip")).toMatchObject({ contentType: "application/zip", ranges: true });
    expect(releaseArtifactForFilename("appcast-1.0.2.xml")).toMatchObject({ contentType: "application/xml; charset=utf-8", ranges: false });
    for (const filename of [
      "TextText.zip",
      "TextText-1.zip",
      "TextText-1.2.dmg",
      "texttext-1.2.zip",
      "appcast.xml",
      "appcast-1.xml",
      "../TextText-1.2.zip",
      "TextText-1.2.zip?token=x",
      "TextText-1..2.zip",
    ]) expect(releaseArtifactForFilename(filename)).toBeNull();
  });

  it("returns a quiet 404 before the durable artifact directory exists", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "texttext-release-empty-"));
    temporaryParents.push(parent);
    const response = await serveReleaseDownload("TextText-1.2.zip", {
      method: "GET",
      root: path.join(parent, "release-artifacts"),
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("serves exact immutable HEAD and GET metadata", async () => {
    const root = await fixtureRoot();
    const head = await serveReleaseDownload("TextText-1.2.zip", { method: "HEAD", root });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("content-type")).toBe("application/zip");
    expect(head.headers.get("content-length")).toBe("5");
    expect(head.headers.get("content-disposition")).toBe('attachment; filename="TextText-1.2.zip"');
    expect(head.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(head.headers.get("accept-ranges")).toBe("bytes");

    const appcast = await serveReleaseDownload("appcast-1.2.xml", { method: "GET", root });
    expect(appcast.status).toBe(200);
    expect(appcast.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(appcast.headers.get("content-disposition")).toBe('inline; filename="appcast-1.2.xml"');
    expect(appcast.headers.get("accept-ranges")).toBeNull();
    expect(await appcast.text()).toBe("<rss />");
  });

  it("streams explicit, open-ended, and suffix ZIP ranges", async () => {
    const root = await fixtureRoot();
    const cases = [
      ["bytes=1-3", [1, 2, 3], "bytes 1-3/5"],
      ["bytes=3-", [3, 4], "bytes 3-4/5"],
      ["bytes=-2", [3, 4], "bytes 3-4/5"],
    ] as const;
    for (const [range, bytes, contentRange] of cases) {
      const response = await serveReleaseDownload("TextText-1.2.zip", { method: "GET", range, root });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(contentRange);
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(bytes);
    }
  });

  it("rejects multiple, malformed, unsatisfiable, and appcast ranges", async () => {
    const root = await fixtureRoot();
    for (const range of ["bytes=0-1,3-4", "items=0-1", "bytes=9-", "bytes=3-1", "bytes=-0"]) {
      const response = await serveReleaseDownload("TextText-1.2.zip", { method: "GET", range, root });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */5");
    }
    const appcast = await serveReleaseDownload("appcast-1.2.xml", { method: "GET", range: "bytes=0-1", root });
    expect(appcast.status).toBe(416);
    expect(appcast.headers.get("content-range")).toBe("bytes */7");
  });

  it("does not follow a symlinked artifact root", async () => {
    const realRoot = await fixtureRoot();
    const linkParent = await mkdtemp(path.join(tmpdir(), "texttext-release-link-"));
    temporaryParents.push(linkParent);
    const linkedRoot = path.join(linkParent, "release-artifacts");
    await symlink(realRoot, linkedRoot);
    const response = await serveReleaseDownload("TextText-1.2.zip", { method: "GET", root: linkedRoot });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("release byte ranges", () => {
  it("normalizes valid ranges and rejects invalid ones", () => {
    expect(parseReleaseRange("bytes=0-999", 5)).toEqual({ start: 0, end: 4 });
    expect(parseReleaseRange("bytes=-99", 5)).toEqual({ start: 0, end: 4 });
    expect(parseReleaseRange("bytes=5-", 5)).toBeNull();
    expect(parseReleaseRange("bytes=1-0", 5)).toBeNull();
  });
});
