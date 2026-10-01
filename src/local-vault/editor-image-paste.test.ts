import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { prepareEditorImagePaste } from "./editor-image-paste";
import { emptyPack, encodePack, openPack } from "./pack";

const bytesFile = (name: string, bytes: Uint8Array) => ({
  name,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
});

describe("editor image paste", () => {
  it("inserts editable Markdown and preserves PNG and animated GIF bytes in the same TextPack", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 255]);
    const gif = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), character => character.charCodeAt(0));
    const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    document.content.body = "Before  after";
    const result = await prepareEditorImagePaste({
      document,
      selection: { from: 7, to: 8 },
      files: [bytesFile("Diagram.png", png), bytesFile("Motion.gif", gif)],
      makeId: (() => { let value = 0; return () => `asset-${++value}`; })(),
    });
    expect(result.document.content.body).toBe("Before ![Diagram](assets/Diagram.png)\n\n![Motion](assets/Motion.gif)after");
    expect(result.document.content.assets).toEqual([
      { id: "asset-1", kind: "image", src: "assets/Diagram.png", alt: "Diagram", contentType: "image/png" },
      { id: "asset-2", kind: "image", src: "assets/Motion.gif", alt: "Motion", contentType: "image/gif" },
    ]);
    const file = {
      markdown: '---\ntextTextId: "note-1"\n---\n\n' + result.document.content.body,
      documentJSON: JSON.stringify(result.document),
      templateJSON: null,
      templateAuthoringSourceJSON: null,
    };
    const additions = result.addedAssets.map(asset => ({
      filename: asset.filename,
      data: Uint8Array.from(atob(asset.data), character => character.charCodeAt(0)),
    }));
    const packed = encodePack(emptyPack(), file, additions);
    const opened = openPack(packed, "Notes/Pasted.textpack", "");
    expect(opened.entries[opened.prefix + "assets/Diagram.png"]).toEqual(png);
    expect(opened.entries[opened.prefix + "assets/Motion.gif"]).toEqual(gif);
  });

  it("allocates a new filename without overwriting an existing asset", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    const result = await prepareEditorImagePaste({
      document,
      selection: { from: 0, to: 0 },
      files: [bytesFile("image.png", png)],
      occupiedFilenames: ["IMAGE.PNG"],
      makeId: () => "asset-1",
    });
    expect(result.addedAssets[0].filename).toBe("image-2.png");
  });
});
