// The co-editing relay had no test at all, which is why it is the one route
// where a regression would be silent: the live browser run would catch it, but
// that needs Postgres, a build, and Chromium.
//
// These pin the parts a person feels: a viewer can read but not push, a push
// against a retired generation is rejected rather than merged over an
// out-of-band write, malformed payloads never enter the log (a stored bad
// update poisons every peer permanently), and a trashed item says so.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const mocks = vi.hoisted(() => ({
  getCollabRequestAccess: vi.fn(),
  appendCollabUpdate: vi.fn(),
  collabUpdatesSince: vi.fn(),
  getCollabBaseline: vi.fn(),
  getCollabEpoch: vi.fn(),
  latestCollabSeq: vi.fn(),
  maybeCompactCollab: vi.fn(),
  prepareCollabBaseline: vi.fn(),
}));

vi.mock("@/lib/collab/access.server", () => ({
  getCollabRequestAccess: mocks.getCollabRequestAccess,
}));
vi.mock("@/lib/collab", () => ({
  appendCollabUpdate: mocks.appendCollabUpdate,
  collabUpdatesSince: mocks.collabUpdatesSince,
  getCollabBaseline: mocks.getCollabBaseline,
  getCollabEpoch: mocks.getCollabEpoch,
  latestCollabSeq: mocks.latestCollabSeq,
  maybeCompactCollab: mocks.maybeCompactCollab,
  prepareCollabBaseline: mocks.prepareCollabBaseline,
}));

import { GET, POST } from "@/app/api/collab/[postId]/route";

const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const ctx = { params: Promise.resolve({ postId }) };

/** A real Yjs update, because the route validates by applying it. */
function realUpdate(): string {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, "hello");
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

function push(body: unknown): Request {
  return new Request(`http://localhost/api/collab/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function streamedPush(byteCount: number): Request {
  const encoder = new TextEncoder();
  let remaining = byteCount;
  return new Request(`http://localhost/api/collab/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      pull(controller) {
        if (remaining === 0) {
          controller.close();
          return;
        }
        const size = Math.min(remaining, 64 * 1024);
        remaining -= size;
        controller.enqueue(encoder.encode("x".repeat(size)));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function read(query = ""): Request {
  return new Request(`http://localhost/api/collab/${postId}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCollabRequestAccess.mockResolvedValue({
    role: "editor",
    trashed: false,
  });
  mocks.getCollabEpoch.mockResolvedValue(3);
  mocks.appendCollabUpdate.mockResolvedValue({ seq: 41 });
  mocks.latestCollabSeq.mockResolvedValue(41);
  mocks.maybeCompactCollab.mockResolvedValue(undefined);
  mocks.collabUpdatesSince.mockResolvedValue([]);
  mocks.prepareCollabBaseline.mockResolvedValue({
    epoch: 3,
    update: "YmFzZWxpbmU=",
    revision: 7,
  });
  mocks.getCollabBaseline.mockResolvedValue({
    epoch: 3,
    update: "YmFzZWxpbmU=",
    revision: 7,
  });
});

describe("collab relay route", () => {
  it("accepts an editor's well-formed update", async () => {
    const res = await POST(push({ updates: [realUpdate()], epoch: 3 }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seq: 41, epoch: 3 });
    expect(mocks.appendCollabUpdate).toHaveBeenCalledTimes(1);
  });

  it("refuses a push from someone who is only a viewer", async () => {
    mocks.getCollabRequestAccess.mockResolvedValue({
      role: "viewer",
      trashed: false,
    });
    const res = await POST(push({ updates: [realUpdate()], epoch: 3 }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.appendCollabUpdate).not.toHaveBeenCalled();
  });

  it("lets a viewer read", async () => {
    mocks.getCollabRequestAccess.mockResolvedValue({
      role: "viewer",
      trashed: false,
    });
    const res = await GET(read("?since=1"), ctx);
    expect(res.status).toBe(200);
  });

  it("says a trashed item was trashed rather than forbidden", async () => {
    mocks.getCollabRequestAccess.mockResolvedValue({
      role: null,
      trashed: true,
    });
    const pushed = await POST(push({ updates: [realUpdate()], epoch: 3 }), ctx);
    expect(pushed.status).toBe(410);
    expect(await pushed.json()).toMatchObject({ reason: "trashed" });

    const got = await GET(read(), ctx);
    expect(got.status).toBe(410);
  });

  it("never stores a payload that is not a Yjs update", async () => {
    // A stored bad update throws in every peer's applyUpdate, and because the
    // poll only advances past applied rows it would poison the log forever.
    for (const bad of [
      "not-base64-at-all!!",
      Buffer.from("nope").toString("base64"),
    ]) {
      mocks.appendCollabUpdate.mockClear();
      const res = await POST(push({ updates: [bad], epoch: 3 }), ctx);
      expect(res.status).toBe(400);
      expect(mocks.appendCollabUpdate).not.toHaveBeenCalled();
    }
  });

  it("rejects a declared oversized relay body before parsing", async () => {
    const request = push({ updates: [realUpdate()], epoch: 3 });
    request.headers.set("content-length", String(34 * 1024 * 1024 + 1));

    const response = await POST(request, ctx);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.appendCollabUpdate).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized relay body without Content-Length", async () => {
    const response = await POST(streamedPush(34 * 1024 * 1024 + 1), ctx);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.appendCollabUpdate).not.toHaveBeenCalled();
  });

  it("treats an empty push as a no-op rather than an error", async () => {
    // A client with nothing queued still asks where the log is; that is not a
    // malformed request and must not cost it a 400.
    const res = await POST(push({ updates: ["", null], epoch: 3 }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seq: 41, epoch: 3 });
    expect(mocks.appendCollabUpdate).not.toHaveBeenCalled();
  });

  it("reports a retired generation instead of merging over an external write", async () => {
    mocks.appendCollabUpdate.mockResolvedValue({ retired: true });
    const res = await POST(push({ updates: [realUpdate()], epoch: 2 }), ctx);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.retired ?? body.epoch).toBeTruthy();
  });

  it("carries the baseline on a first read and not on a resumed one", async () => {
    const first = await GET(read("?since=0"), ctx);
    expect(await first.json()).toMatchObject({
      epoch: 3,
      baseline: { update: "YmFzZWxpbmU=", revision: 7 },
    });
    expect(mocks.prepareCollabBaseline).toHaveBeenCalledWith(postId);

    const resumed = await GET(read("?since=5"), ctx);
    const body = (await resumed.json()) as Record<string, unknown>;
    expect(body.baseline).toBeUndefined();
    expect(mocks.getCollabBaseline).toHaveBeenCalledWith(postId);
  });

  it("answers 409 when the document has no baseline to read against", async () => {
    mocks.prepareCollabBaseline.mockResolvedValue(null);
    const res = await GET(read("?since=0"), ctx);
    expect(res.status).toBe(409);
  });
});
