import { describe, expect, it } from "vitest";
import { vaultReferenceChoices } from "./reference-choices";
it("uses listing identities and saved titles without leaking templates or self links", () => {
 expect(vaultReferenceChoices([
  {path:"Notes/One.textpack",itemId:"one",title:"Saved title"},
  {path:"Notes/Copy.textpack",itemId:"one",title:"Duplicate"},
  {path:"Notes/Self.textpack",itemId:"self",title:"Self"},
  {path:"Templates/Private.textpack",itemId:"template",title:"Template"},
  {path:"Notes/Unknown.textpack",title:"Unindexed"},
 ], "self")).toEqual([{id:"one",label:"Saved title",description:"Document"}]);
});

import { vi, beforeEach } from "vitest";
import { createVaultDocumentReferences } from "./reference-choices";
import { vaultRequest } from "./bridge";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { newItemPack } from "./new-item-pack";
import { openPack, replacePackIdentity } from "./pack";
vi.mock("./bridge", () => ({vaultRequest:vi.fn()}));
describe.sequential("native reference source", () => {
const request = vi.mocked(vaultRequest);
beforeEach(() => { request.mockReset(); });
function file(id="parent", path="Notes/Parent.textpack") {
 const template=requireBuiltinTemplate("texttext.note",2);
 const document=emptyDocumentSnapshot({id:template.id,version:2});
 document.content.title="Saved parent title";
 const value=openPack(newItemPack(document,{template}),path,"revision").file;
 return {...value,markdown:replacePackIdentity(value.markdown,id)};
}
it("searches path-only native listings without reading every result and resolves only the selection", async () => {
 request.mockImplementation(async (method) => {
  if(method==="search") return {items:[{path:"Notes/Parent.textpack",title:"Search title"},{path:"Templates/Private.textpack",title:"Private"}]};
  if(method==="read") return file();
  throw new Error(`Unexpected request: ${String(method)}`);
 });
 const source=createVaultDocumentReferences("child");const signal=new AbortController().signal;
 expect(await source.search("",signal)).toEqual([]);expect(request).not.toHaveBeenCalled();
 const choices=await source.search("parent",signal);
 expect(choices).toEqual([{id:"path:Notes/Parent.textpack",label:"Search title"}]);
 expect(request).toHaveBeenCalledTimes(1);
 expect(await source.resolve(choices[0].id,signal)).toEqual({id:"parent",label:"Saved parent title"});
 expect(request).toHaveBeenLastCalledWith("read",{path:"Notes/Parent.textpack"},signal);
});
it("re-resolves saved identities and refuses replacement identities or self links", async () => {
 request.mockImplementation(async method => method==="resolveItemId"?{path:"Notes/Parent.textpack"}:file("replacement"));
 await expect(createVaultDocumentReferences().resolve("parent",new AbortController().signal)).rejects.toThrow("changed");
 request.mockResolvedValue(file("child"));
 await expect(createVaultDocumentReferences("child").resolve("path:Notes/Parent.textpack",new AbortController().signal)).rejects.toThrow("changed");
});
it("does not read forbidden template paths and keeps read permission failures visible", async () => {
 await expect(createVaultDocumentReferences().resolve("path:Templates/Private.textpack",new AbortController().signal)).rejects.toThrow("not available");
 expect(request).not.toHaveBeenCalled();
 request.mockRejectedValue(new Error("Access removed"));
 await expect(createVaultDocumentReferences().resolve("path:Notes/Parent.textpack",new AbortController().signal)).rejects.toThrow("Access removed");
});

});
