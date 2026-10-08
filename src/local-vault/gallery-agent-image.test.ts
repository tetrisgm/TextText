import { describe, expect, it, vi } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import type { VaultFile } from "./bridge";
import { galleryAgentImage } from "./gallery-agent-image";

function fixture(): VaultFile {
  const document = emptyDocumentSnapshot();
  document.content.assets = [{ id: "first", kind: "image", src: "assets/first.jpg" }, { id: "selected", kind: "image", src: "assets/selected.png" }];
  return { path: "Gallery/A.textpack", hash: "current", markdown: "", documentJSON: JSON.stringify(document), assets: [{ filename: "first.jpg", contentType: "image/jpeg", data: "first-bytes" }, { filename: "selected.png", contentType: "image/png", data: "selected-bytes" }] };
}
describe("selected Gallery image input", () => {
  it("prepares only the exact embedded selected image, never its neighbor", async () => {
    const prepared = { name: "photo.jpg", mediaType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AA==" };
    const prepare = vi.fn(async () => prepared);
    expect(await galleryAgentImage(fixture(), "selected", prepare)).toBe(prepared);
    expect(prepare).toHaveBeenCalledExactlyOnceWith("selected-bytes", "image/png");
  });
  it.each(["missing", "duplicate", "unavailable", "ambiguous-bytes", "invalid-id"])("refuses %s without preparing or fetching another image", async kind => {
    const file = fixture(), document = JSON.parse(file.documentJSON!);
    if (kind === "duplicate") document.content.assets.push({ ...document.content.assets[1] });
    if (kind === "unavailable") document.content.assets[1].src = "https://example.com/private.jpg";
    if (kind === "ambiguous-bytes") file.assets!.push({ ...file.assets![1] });
    file.documentJSON = JSON.stringify(document);
    const prepare = vi.fn();
    await expect(galleryAgentImage(file, kind === "missing" ? "gone" : kind === "invalid-id" ? "" : "selected", prepare)).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
});
