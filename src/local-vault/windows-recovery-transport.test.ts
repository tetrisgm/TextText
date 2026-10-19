import { afterEach, expect, it, vi } from "vitest";
import { createWindowsVaultTransport } from "./windows-transport";

afterEach(() => vi.unstubAllGlobals());
function native(handler: (method: string, params: Record<string, unknown>) => unknown) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const messages: { id: string; method: string; params: Record<string, unknown> }[] = [];
  return { messages,
    addEventListener: (_: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
    postMessage(value: unknown) {
      const message = value as typeof messages[number]; messages.push(message);
      void Promise.resolve().then(() => handler(message.method, message.params)).then(
        result => { for (const listener of listeners) listener({ data: { id: message.id, result } } as MessageEvent); },
        error => { for (const listener of listeners) listener({ data: { id: message.id, error: { message: error.message } } } as MessageEvent); });
    },
  };
}
const status = { root: "C:\\Bound", workspaceId: "workspace", name: "Workspace", accountId: "account-a", available: true, connected: true };
const replacement = { id: "operation", path: "Moved.textpack", itemId: "item", currentHash: "a".repeat(64), preparedHash: "b".repeat(64), displacedHash: "c".repeat(64), savedAt: "2026-10-18" };

it.each([false, true])("keeps bound local recovery available with hosted history offline=%s", async offline => {
  vi.stubGlobal("window", new EventTarget());
  const view = native((method, params) => {
    if (method === "native.status") return status;
    if (method === "files.savedFileMoveList") return {entries:[],truncated:false};
    if (method === "files.folderSyncMoveList") return [];
    if (method === "files.folderRenameList") return [];
    if (method === "files.replacementList") { expect(params.workspaceRoot).toBe(status.root); return [replacement]; }
    if (method === "files.recoveryAssets") return { assets: [{ id: "asset", filename: "submitted.asset", byteLength: 3, hash: "d".repeat(64), savedAt: "2026-10-18" }], assetsTruncated: true };
    if (method === "native.http") {
      if (offline) throw new Error("Offline");
      return { status: 200, headers: { "Content-Type": "application/json" }, body: btoa(JSON.stringify({ entries: [{ id: "server-copy" }], truncated: false })) };
    }
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    const result = await transport.request("recoveryList", { workspaceRoot: "C:\\Untrusted" }) as Record<string, unknown>;
    expect(result).toMatchObject({ replacements: [replacement], assetsTruncated: true });
    expect(result.entries).toEqual(offline ? [] : [{ id: "server-copy" }]);
    expect(Boolean(result.warning)).toBe(offline);
  } finally { transport.destroy(); }
});

it("surfaces a corrupt native registry before requesting server recovery", async () => {
  vi.stubGlobal("window", new EventTarget());
  const view = native(method => {
    if (method === "native.status") return status;
    if (method === "files.savedFileMoveList") return {entries:[],truncated:false};
    if (method === "files.folderSyncMoveList") return [];
    if (method === "files.folderRenameList") return [];
    if (method === "files.replacementList") throw new Error("Recovery registry is corrupt");
    throw new Error("Unexpected " + method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    await expect(transport.request("recoveryList", {})).rejects.toThrow("Recovery registry is corrupt");
    expect(view.messages.some(message => message.method === "native.http")).toBe(false);
  } finally { transport.destroy(); }
});

it("returns opaque displaced bytes and binds explicit resolution and raw downloads to the captured root", async () => {
  vi.stubGlobal("window", new EventTarget());
  const retained = { opaque: true, path: "Moved.textpack", hash: "c".repeat(64), data: btoa("not a ZIP"), parseError: "Retained file" };
  const view = native((method, params) => {
    if (method === "native.status") return status;
    if (method === "files.savedFileMoveList") return {entries:[],truncated:false};
    if (method === "files.folderSyncMoveList") return [];
    if (method === "files.folderRenameList") return [];
    expect(params.workspaceRoot).toBe(status.root);
    if (method === "files.replacementRead") return retained;
    if (method === "files.resolveReplacement") return { resolved: true };
    if (method === "files.recoveryAssetRead") return { filename: "submitted.asset", hash: "d".repeat(64), byteLength: 3, data: "AQID" };
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    expect(await transport.request("replacementRead", { id: "operation", version: "displaced", workspaceRoot: "other" })).toEqual(retained);
    expect(await transport.request("resolveReplacement", { ...replacement, workspaceRoot: "other" })).toEqual({ resolved: true });
    expect(await transport.request("recoveryAssetRead", { id: "asset", hash: "d".repeat(64), workspaceRoot: "other" })).toMatchObject({ data: "AQID", byteLength: 3 });
  } finally { transport.destroy(); }
});

it("returns explicit removal absence without parsing a fabricated empty pack", async () => {
  vi.stubGlobal("window", new EventTarget());
  const absent = { absent: true, path: "Removed.textpack", hash: null, data: null };
  const view = native(method => {
    if (method === "native.status") return status;
    if (method === "files.savedFileMoveList") return {entries:[],truncated:false};
    if (method === "files.folderSyncMoveList") return [];
    if (method === "files.folderRenameList") return [];
    if (method === "files.replacementRead") return absent;
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    expect(await transport.request("replacementRead", { id: "removed", version: "current" })).toEqual(absent);
    expect(await transport.request("replacementRead", { id: "removed", version: "displaced" })).toEqual(absent);
    await expect(transport.request("replacementRead", { id: "removed", version: "prepared" })).rejects.toThrow("Invalid local recovery response");
  } finally { transport.destroy(); }
});


it("binds four-version move consent to the original native root", async () => {
  vi.stubGlobal("window", new EventTarget());
  const move = { ...replacement, kind: "move", sourcePath: "Original.textpack", sourcePresent: false, sourceHash: null, currentPresent: true, captured: true };
  const view = native((method, params) => {
    if (method === "native.status") return status;
    if (method === "files.savedFileMoveList") return {entries:[],truncated:false};
    if (method === "files.folderSyncMoveList") return [];
    if (method === "files.folderRenameList") return [];
    if (method === "files.resolveMove") {
      expect(params).toMatchObject({ ...move, workspaceRoot: status.root });
      return { resolved: true };
    }
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    expect(await transport.request("resolveMove", { ...move, workspaceRoot: "untrusted" })).toEqual({ resolved: true });
  } finally { transport.destroy(); }
});


it("preserves an absent original move path without fabricating a TextPack", async () => {
  vi.stubGlobal("window", new EventTarget());
  const absent = { absent: true, path: "Original.textpack", hash: null, data: null };
  const view = native(method => {
    if (method === "native.status") return status;
    if (method === "files.savedFileMoveList") return {entries:[],truncated:false};
    if (method === "files.folderSyncMoveList") return [];
    if (method === "files.folderRenameList") return [];
    if (method === "files.replacementRead") return absent;
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try { expect(await transport.request("replacementRead", { id: "operation", version: "source" })).toEqual(absent); }
  finally { transport.destroy(); }
});

it("lists global folder recovery before fenced file history and scopes inspection and consent", async () => {
  vi.stubGlobal("window", new EventTarget());
  const folder = { id: "folder-op", fromPath: "notes", toPath: "Notes", expectedIdentity: "1:2", from: { present: false, identity: null }, to: { present: true, identity: "1:3" }, inspection: "e".repeat(64), summary: "Retained folder details", resolutionBlocked: null, resolved: false };
  const view = native((method, params) => {
    if (method === "native.status") return status;
    if (method === "files.savedFileMoveList") return {entries:[],truncated:false};
    expect(params).toMatchObject({workspaceRoot: status.root, workspaceId: status.workspaceId, accountId: status.accountId});
    if (method === "files.folderSyncMoveList") return [];
    if (method === "files.folderRenameList") return [folder];
    if (method === "files.folderRenameRead") return folder;
    if (method === "files.resolveFolderRename") return { resolved: true };
    throw new Error("Fenced history must not be accessed: " + method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    expect(await transport.request("recoveryList", {path: "elsewhere.textpack"})).toMatchObject({folderRenames: [folder], entries: [], replacements: [], assets: []});
    expect(await transport.request("folderRenameRead", { id: folder.id, workspaceRoot: "untrusted", accountId: "other" })).toEqual(folder);
    expect(await transport.request("resolveFolderRename", { id: folder.id, fromPath: folder.fromPath, toPath: folder.toPath, inspection: folder.inspection, workspaceRoot: "untrusted" })).toEqual({resolved: true});
    expect(view.messages.map(m => m.method)).toEqual(["native.status", "files.savedFileMoveList", "files.folderSyncMoveList", "files.folderRenameList", "files.folderRenameRead", "files.resolveFolderRename"]);
  } finally { transport.destroy(); }
});

it("keeps saved folder commands visible before fenced metadata reads and binds fresh inspection/consent to native scope",async()=>{
 vi.stubGlobal("window",new EventTarget());const entry={id:"saved-folder",state:"unavailable"};
 const view=native((method,params)=>{
  if(method==="native.status")return status;
  if(method==="files.savedFileMoveList")return {entries:[],truncated:false};
  expect(params.workspaceRoot).toBe(status.root);expect(params.workspaceId).toBe(status.workspaceId);expect(params.accountId).toBe(status.accountId);
  if(method==="files.folderSyncMoveList")return[entry];
  if(method==="files.folderSyncMoveRead")return entry;
  if(method==="files.resolveFolderSyncMove")return{resolved:true};
  throw Error("Unexpected fenced request "+method);
 });const transport=await createWindowsVaultTransport(view);
 try{
  expect(await transport.request("recoveryList",{})).toMatchObject({folderSyncMoves:[entry],entries:[],replacements:[],assets:[]});
  expect(await transport.request("folderSyncMoveRead",{id:entry.id,workspaceRoot:"foreign",accountId:"foreign"})).toEqual(entry);
  expect(await transport.request("resolveFolderSyncMove",{id:entry.id,inspection:"i",localInspection:"l",requestHash:"r",consent:true})).toEqual({resolved:true});
  expect(view.messages.map(m=>m.method)).toEqual(["native.status","files.savedFileMoveList","files.folderSyncMoveList","files.folderSyncMoveRead","files.resolveFolderSyncMove"]);
 }finally{transport.destroy();}
});

it("binds saved file move reads and explicit consent to the selected native workspace", async () => {
  vi.stubGlobal("window",new EventTarget());
  const view=native((method,params)=>{
    if(method==="native.status")return status;
    if(["files.savedFileMoveRead","files.retrySavedFileMove","files.keepSavedFileMoveNames"].includes(method)){
      expect(params).toMatchObject({workspaceRoot:status.root,workspaceId:status.workspaceId,accountId:status.accountId,id:"saved"});
      return {resolved:true};
    }
    throw Error(method);
  });
  const transport=await createWindowsVaultTransport(view);
  try {
    for(const method of ["savedFileMoveRead","retrySavedFileMove","keepSavedFileMoveNames"]){
      await transport.request(method,{workspaceRoot:"wrong",workspaceId:"wrong",accountId:"wrong",id:"saved",requestHash:"a".repeat(64),inspection:"b".repeat(64),consent:true});
    }
    expect(view.messages.slice(1).every(m=>m.params.consent===true&&m.params.inspection==="b".repeat(64))).toBe(true);
  } finally {transport.destroy();}
});

it("keeps saved moves available offline and filters before the native bounded list", async () => {
  vi.stubGlobal("window",new EventTarget());
  const view=native((method,params)=>{
    if(method==="native.status")return status;
    if(method==="files.savedFileMoveList"){expect(params).toEqual({workspaceRoot:status.root,workspaceId:status.workspaceId,accountId:status.accountId,path:"Notes/one.textpack"});return {entries:[{id:"saved"}],truncated:true};}
    if(["files.folderSyncMoveList","files.folderRenameList","files.replacementList"].includes(method))return [];
    if(method==="files.recoveryAssets")return {assets:[],assetsTruncated:false};
    if(method==="native.http")throw Error("Offline");
    throw Error(method);
  });
  const transport=await createWindowsVaultTransport(view);
  try {expect(await transport.request("recoveryList",{path:"Notes/one.textpack",workspaceRoot:"wrong"})).toMatchObject({savedFileMoves:[{id:"saved"}],savedFileMovesTruncated:true,warning:expect.any(String)});}
  finally {transport.destroy();}
});
