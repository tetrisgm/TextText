import { expect, it } from "vitest";
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
