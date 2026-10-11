import { describe, expect, it } from "vitest";
import { refreshBinaryOnlyFile } from "./binary-refresh";
import type { VaultFile } from "./bridge";

const initial: VaultFile = {
  path: "Notes/Shared.textpack", hash: "before", markdown: "---\ntextTextId: item-1\n---\n\nPending human text",
  documentJSON: '{"body":"Pending human text"}', assets: [{ filename: "data.txt", contentType: "text/plain", data: "b2xk" }],
};

describe("binary refresh of an open shared file", () => {
  it("adopts an asset-only native file revision while retaining the editor text", () => {
    const fresh = { ...initial, hash: "after", assets: [{ filename: "data.txt", contentType: "text/plain", data: "bmV3" }] };
    expect(refreshBinaryOnlyFile(initial, fresh, "item-1", true)).toEqual(fresh);
    expect(refreshBinaryOnlyFile(initial, { ...fresh, markdown: fresh.markdown + " external" }, "item-1", true)).toBeNull();
  });
  it("refreshes web assets across a concurrent text revision without adopting stale text or hash", () => {
    const fresh = { ...initial, hash: "remote", markdown: initial.markdown + " external",
      assets: [{ filename: "data.txt", contentType: "text/plain", data: "bmV3" }] };
    expect(refreshBinaryOnlyFile(initial, fresh, "item-1", false)).toEqual({ ...initial, assets: fresh.assets });
    expect(refreshBinaryOnlyFile(initial, { ...fresh, markdown: fresh.markdown.replace("item-1", "other") }, "item-1", false)).toBeNull();
  });
});
