import { describe, expect, it } from "vitest";
import type { Blog, Post } from "@/lib/content";
import { documentFromLegacyPost } from "@/lib/documents/legacy";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { parseTextpack } from "@/lib/github/textpack";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";
import { prepareLegacyTextpack } from "../prepare-legacy-textpack";
const blog: Blog = { handle: "demo", name: "Demo", author: "Author", homeLayout: "list" };
const legacy: Post = { id: "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60", type: "article", slug: "hello", title: "Hello", body: "Keep everything", date: "2026-07-01", status: "draft", revision: 7 };
function fixture() {
 const document = documentFromLegacyPost(legacy);
 const template = getBuiltinTemplate(document.presentation.template.id, document.presentation.template.version)!;
 document.content.assets = [{ id: "photo", kind: "image", src: "https://example.test/photo.png", caption: "Original caption", poster: "https://example.test/poster.png" }];
 return { blog, template, post: { ...legacy, document }, path: "Blog/Hello.textpack", folderPath: "Blog", comments: [], assets: [
  { source: "https://example.test/photo.png", path: "assets/photo.png", bytes: new Uint8Array([1,2,3]), contentType: "image/png" },
  { source: "https://example.test/poster.png", path: "assets/poster.png", bytes: new Uint8Array([4,5]), contentType: "image/png" },
 ] };
}
describe("legacy migration preparation", () => {
 it.each(["", "\n\nLeading blank lines", "Trailing spaces  ", "Final newline\n", "\r\nWindows line\r\n"])("keeps body whitespace through the actual file reader: %j", body => {
  const input = fixture(); input.post.document.content.body = body;
  const result = prepareLegacyTextpack(input);
  expect(readDocument(openPack(result.bytes, result.path, result.hash, legacy.id).file).content.body).toBe(body);
 });
 it("preserves identity, entire snapshot and asset bytes deterministically without mutating input", () => {
  const input=fixture(); const before=structuredClone(input); const result=prepareLegacyTextpack(input); const pack=parseTextpack(result.bytes);
  expect(result.itemId).toBe(legacy.id); expect(pack.markdown).toContain(legacy.id); expect(pack.document).toEqual(input.post.document); expect(pack.template).toEqual(input.template);
  expect(pack.files?.["assets/photo.png"]).toEqual(input.assets[0].bytes); expect(pack.info?.["net.texttext.assets"]).toEqual({"photo.png":{url:input.assets[0].source,contentType:"image/png"},"poster.png":{url:input.assets[1].source,contentType:"image/png"}});
  expect(prepareLegacyTextpack(input)).toEqual(result); expect(input).toEqual(before); expect(result.sourceRevision).toBe(7);
  const opened = openPack(result.bytes, result.path, result.hash, legacy.id);
  expect(opened.itemId).toBe(legacy.id);
  expect(readDocument(opened.file)).toEqual(input.post.document);
  expect(opened.file.assets?.map(asset => ({ source: asset.remoteURL, data: asset.data }))).toEqual([
    { source: input.assets[0].source, data: Buffer.from(input.assets[0].bytes).toString("base64") },
    { source: input.assets[1].source, data: Buffer.from(input.assets[1].bytes).toString("base64") },
  ]);
 });
 it("refuses unmanaged inline media rather than pretending the pack is complete", () => { const input=fixture(); input.post.document.content.body="![image](https://example.test/untracked.png)"; expect(()=>prepareLegacyTextpack(input)).toThrow(/Inline media/); });
 it("refuses missing original asset or poster bytes", () => { const input=fixture(); input.assets.pop(); expect(()=>prepareLegacyTextpack(input)).toThrow(/Missing bytes/); });
 it.each(["../x.textpack", "/x.textpack", "Blog/CON.textpack", "Blog/x.txt", "Blog/../x.textpack"])("rejects unsafe destination %s", path => expect(()=>prepareLegacyTextpack({...fixture(),path})).toThrow(/path/));
 it("rejects unsafe and case-colliding asset entries", () => {const input=fixture(); input.assets[1].path="assets/PHOTO.png"; expect(()=>prepareLegacyTextpack(input)).toThrow(/duplicate/); input.assets[1].path="assets/../outside"; expect(()=>prepareLegacyTextpack(input)).toThrow(/Unsafe/);});
 it("refuses comments rather than silently dropping them", () => expect(()=>prepareLegacyTextpack({...fixture(),comments:[{body:"Keep me"}]})).toThrow(/Comment/));
 it("requires identity and resolved look", () => { const input=fixture(); expect(()=>prepareLegacyTextpack({...input,post:{...input.post,id:undefined}})).toThrow(/UUID/); input.post.document.presentation.template={id:"custom",version:1}; expect(()=>prepareLegacyTextpack(input)).toThrow(/template/); });
});
