import { describe, expect, it, vi } from "vitest";
import { locateVaultItem, locateVaultItemOrResolve } from "./item-location";
import type { VaultListing } from "./bridge";
const listing = (items: VaultListing["items"]): VaultListing => ({ root: "workspace", items });
describe("open document location", () => {
  it("follows identity through a move even when the old path is reused", () => {
    expect(locateVaultItem("one", listing([{ itemId: "other", path: "Notes/Old.textpack" },
      { itemId: "one", path: "Archive/New.textpack", canEditContent: false }])))
      .toEqual({ itemId: "one", path: "Archive/New.textpack", canEditContent: false });
  });
  it("refuses missing, duplicate and unidentified files", () => {
    expect(locateVaultItem(null, listing([{ path: "Notes/One.textpack" }]))).toBeNull();
    expect(locateVaultItem("one", listing([{ itemId: "other", path: "Notes/One.textpack" }]))).toBeNull();
    expect(locateVaultItem("one", listing([{ itemId: "one", path: "A" }, { itemId: "one", path: "B" }]))).toBeNull();
    expect(locateVaultItem("one", listing([{ itemId: "one", path: "A" }, { itemId: "other", path: "A" }]))).toBeNull();
  });
});
describe('locateVaultItemOrResolve',()=>{
 const listing={root:'/v',items:[{path:'Notes/New.textpack',canEditContent:true},{path:'Notes/Other.textpack',itemId:'other',canEditContent:true}]};
 it('adopts only an unidentified row at the store-resolved path',async()=>{
  expect(await locateVaultItemOrResolve('a','Notes/Old.textpack',listing,async()=>({path:'Notes/New.textpack'}))).toEqual(listing.items[0]);
  expect(await locateVaultItemOrResolve('a','Notes/Old.textpack',listing,async()=>({path:'Notes/Other.textpack'}))).toBeNull();
  expect(await locateVaultItemOrResolve('a','Notes/Old.textpack',listing,async()=>({path:'Notes/Missing.textpack'}))).toBeNull();
  expect(await locateVaultItemOrResolve('a','Notes/Old.textpack',listing,async()=>{throw new Error('gone');})).toBeNull();
 });
 it('does not consult the store when the path or identity is already listed',async()=>{
  const resolve=vi.fn(async()=>({path:'Notes/New.textpack'}));
  expect(await locateVaultItemOrResolve('a','Notes/New.textpack',listing,resolve)).toBeNull();
  expect(await locateVaultItemOrResolve('other','Notes/Old.textpack',listing,resolve)).toEqual(listing.items[1]);
  expect(await locateVaultItemOrResolve(null,'Notes/Old.textpack',listing,resolve)).toBeNull();
  expect(resolve).not.toHaveBeenCalled();
 });
});
