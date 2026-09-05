import { readFileSync } from "node:fs";
import ts from "typescript";
import { it, expect, vi } from "vitest";
import * as Y from "yjs";
import { applyDocumentSnapshot, applyDocumentBaseline, documentSnapshotFromYDoc, documentText, hasDocumentSnapshot } from "@/lib/collab/document";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { preReadyTextOperations, applyPreReadyTextOperations, applyPreReadyMetadata } from "@/lib/collab/pre-ready";
const editor=readFileSync("src/components/document/UnifiedDocumentEditor.tsx","utf8");
function compile(source:string,name:string,bindings:Record<string,unknown>){
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return new Function(...Object.keys(bindings),js+`;return ${name};`)(...Object.values(bindings));
}
const replaceYText=compile(editor.slice(editor.indexOf("function replaceYText("),editor.indexOf("\nfunction selectionForField(")),"replaceYText",{});
const overlayPreReadyEdits=compile(editor.slice(editor.indexOf("export function overlayPreReadyEdits("),editor.indexOf("\nfunction bytesToBase64(")).replace("export function","function"),"overlayPreReadyEdits",{});
const snapshot=(body:string)=>validateDocumentSnapshot({schemaVersion:1,content:{title:"Probe",body,fields:{},tags:[],assets:[]},presentation:{template:{id:"texttext.note",version:1},theme:{}}});
function reconcile(initial: ReturnType<typeof snapshot>,local: ReturnType<typeof snapshot>,remote: ReturnType<typeof snapshot>){
 const doc=new Y.Doc();applyDocumentSnapshot(doc,remote,"baseline");
 const source=editor.slice(editor.indexOf("      const localBeforeReady ="),editor.indexOf("      readyRef.current = true;"));
 compile(source,"remote",{doc,requireDocumentSnapshot:validateDocumentSnapshot,preReadyTextOperations,applyPreReadyTextOperations,applyPreReadyMetadata,preserveRecovery:vi.fn(),provider:{learnedEpoch:1},preReadyLocalRef:{current:local},documentRef:{current:local},initialDocumentRef:{current:initial},hasDocumentSnapshot,applyDocumentBaseline,documentSnapshotFromYDoc,documentText,replaceYText,localOrigin:{current:{}},overlayPreReadyEdits,applyDocumentSnapshot,publishDocument:()=>{}});
 const result=documentSnapshotFromYDoc(doc);doc.destroy();return result;
}
it("preserves a disjoint remote suffix when local deletes at readiness",()=>{
 const result=reconcile(snapshot("alpha DELETE omega"),snapshot("alpha omega"),snapshot("alpha DELETE omega REMOTE"));
 expect(result.content.body).toBe("alpha omega REMOTE");
});
it("preserves a remote deletion when local appends at readiness",()=>{
 const result=reconcile(snapshot("alpha DELETE omega"),snapshot("alpha DELETE omega!"),snapshot("alpha omega"));
 expect(result.content.body).toBe("alpha omega!");
});
it("confirms metadata ordering fix preserves own text deletion",()=>{
 const initial=snapshot("alpha DELETE omega"),local=snapshot("alpha omega");local.content.tags=["local"];
 const result=reconcile(initial,local,initial);
 expect(result.content.body).toBe("alpha omega");expect(result.content.tags).toEqual(["local"]);
});
it("keeps remote field additions and deletions when local only changes tags",()=>{
 const initial=snapshot("body");initial.content.fields={obsolete:"DELETE ME"};
 const local=structuredClone(initial);local.content.tags=["local"];
 const remote=snapshot("body");remote.content.fields={newValue:"REMOTE"};
 const result=reconcile(initial,local,remote);
 expect(result.content.fields).toEqual({newValue:"REMOTE"});
 expect(result.content.tags).toEqual(["local"]);
});

it.each(["title", "subtitle", "body"] as const)("merges disjoint changes in %s and preserves peer identities", (field) => {
 const initial=snapshot("alpha DELETE omega");initial.content[field]="alpha DELETE omega";
 const local=structuredClone(initial);local.content[field]="alpha omega";
 const peer=new Y.Doc();applyDocumentSnapshot(peer,initial,"baseline");
 const doc=new Y.Doc();Y.applyUpdate(doc,Y.encodeStateAsUpdate(peer));
 documentText(peer,field).insert(documentText(peer,field).length," REMOTE");
 Y.applyUpdate(doc,Y.encodeStateAsUpdate(peer),"collab-remote");
 const operations=preReadyTextOperations(initial.content[field]!,local.content[field]!,documentText(doc,field).toString());
 applyPreReadyTextOperations(documentText(doc,field),operations,"local");
 expect(documentText(doc,field).toString()).toBe("alpha omega REMOTE");
 documentText(peer,field).delete(documentText(peer,field).length-7,7);
 Y.applyUpdate(doc,Y.encodeStateAsUpdate(peer),"collab-remote");
 Y.applyUpdate(peer,Y.encodeStateAsUpdate(doc),"collab-remote");
 expect(documentText(doc,field).toString()).toBe("alpha omega");
 expect(documentText(peer,field).toString()).toBe("alpha omega");
 doc.destroy();peer.destroy();
});

it.each([
 ["ab cd ef gh", "aB cd ef gH", "ab cD eF gh", "aB cD eF gH"],
 ["alpha old omega", "alpha LOCAL omega", "alpha REMOTE omega", "alpha REMOTELOCAL omega"],
 ["alpha DELETE omega", "alpha omega", "alpha DELpeerETE omega", "alpha peeromega"],
 ["abc", "ac", "ac", "ac"],
 ["abc", "aXbc", "aXbc", "aXbc"],
 ["abc", "", "abXc", "X"],
 ["abc", "abc!", "", "!"],
 ["abc", "aXbc", "aYbc", "aYXbc"],
 ["", "LOCAL", "REMOTE", "REMOTELOCAL"],
 ["😀 alpha DELETE ω", "😀 alpha ω!", "😀 alpha DELETE ω REMOTE", "😀 alpha ω REMOTE!"],
])("merges baseline %j, local %j, remote %j", (base,local,remote,expected) => {
 const doc=new Y.Doc(),target=doc.getText("probe");target.insert(0,remote);
 applyPreReadyTextOperations(target,preReadyTextOperations(base,local,remote),"local");
 expect(target.toString()).toBe(expected);doc.destroy();
});

it("only applies locally changed metadata entries and pins the whole template reference",()=>{
 const initial=snapshot("body");
 initial.content.fields={obsolete:"delete remotely",edited:"old",localDelete:"delete locally"};
 initial.content.tags=["remoteDelete","localDelete","keep"];
 initial.content.assets=[{id:"obsolete",kind:"file",src:"old"},{id:"edited",kind:"file",src:"old"}];
 const local=structuredClone(initial);
 local.content.fields.edited="local";delete local.content.fields.localDelete;
 local.content.tags=["remoteDelete","keep","local"];
 local.content.assets[1].src="local";
 local.presentation.template={id:"texttext.article",version:2};
 const remote=structuredClone(initial);
 delete remote.content.fields.obsolete;remote.content.fields.remote="remote";
 remote.content.tags=["localDelete","keep","remote"];
 remote.content.assets=[{id:"edited",kind:"file",src:"old"},{id:"remote",kind:"file",src:"remote"}];
 remote.presentation.theme={accent:"#123456"};
 const result=reconcile(initial,local,remote);
 expect(result.content.fields).toEqual({edited:"local",remote:"remote"});
 expect(result.content.tags).toEqual(["keep","remote","local"]);
 expect(result.content.assets).toEqual([{id:"edited",kind:"file",src:"local"},{id:"remote",kind:"file",src:"remote"}]);
 expect(result.presentation).toEqual({template:local.presentation.template,theme:remote.presentation.theme});
});

it("leaves all metadata untouched when only local text changed",()=>{
 const initial=snapshot("alpha DELETE omega"),local=snapshot("alpha omega"),remote=snapshot("alpha DELETE omega REMOTE");
 remote.content.tags=["remote"];
 expect(reconcile(initial,local,remote).content).toMatchObject({body:"alpha omega REMOTE",tags:["remote"]});
});

it("ledgers typing and metadata even after a partial catch-up installed the baseline",()=>{
 const initial=snapshot("alpha DELETE omega"),doc=new Y.Doc();applyDocumentSnapshot(doc,initial);
 const ledger={current:null as ReturnType<typeof snapshot>|null};
 const bindings={doc,networkEnabled:true,ready:false,preReadyLocalRef:ledger,
  publishDocument:vi.fn(),setSaveState:vi.fn(),hasDocumentSnapshot,applyDocumentSnapshot,
  userEditOrigin:{current:{}},localOrigin:{current:{}},bodyMirrorRef:{current:{}},
  currentLocalDocument:()=>ledger.current??initial,promoteOnEdit:vi.fn(),replaceYText,
  useCallback:(callback:unknown)=>callback,useLayoutEffect:()=>{},updateTextRef:{current:null}};
 const updateText=compile(editor.slice(editor.indexOf("  const updateText = useCallback("),editor.indexOf("  // The bridge the assistant reads through.")),"updateText",bindings);
 updateText("body","alpha omega");
 expect(ledger.current?.content.body).toBe("alpha omega");
 expect(documentText(doc,"body").toString()).toBe("alpha DELETE omega");
 const updateMetadata=compile(editor.slice(editor.indexOf("  const updateDocumentSnapshot = useCallback("),editor.indexOf("  const updateField = useCallback(")),"updateDocumentSnapshot",bindings);
 const tagged=structuredClone(ledger.current!);tagged.content.tags=["local"];
 updateMetadata(tagged);
 expect(ledger.current?.content.tags).toEqual(["local"]);
 expect(documentSnapshotFromYDoc(doc)).toEqual(initial);
 doc.destroy();
});

it("preserves tag and asset identities so later peer deletions still apply",()=>{
 const initial=snapshot("body");initial.content.tags=["peer"];
 initial.content.assets=[{id:"peer",kind:"file",src:"peer"}];
 const peer=new Y.Doc();applyDocumentSnapshot(peer,initial);
 const doc=new Y.Doc();Y.applyUpdate(doc,Y.encodeStateAsUpdate(peer));
 const local=structuredClone(initial);local.content.tags.push("local");
 local.content.assets.push({id:"local",kind:"file",src:"local"});
 applyPreReadyMetadata(doc,overlayPreReadyEdits(local,initial,documentSnapshotFromYDoc(doc))!,"local");
 const removed=structuredClone(initial);removed.content.tags=[];removed.content.assets=[];
 applyDocumentSnapshot(peer,removed);
 Y.applyUpdate(doc,Y.encodeStateAsUpdate(peer),"collab-remote");
 Y.applyUpdate(peer,Y.encodeStateAsUpdate(doc),"collab-remote");
 expect(documentSnapshotFromYDoc(doc).content.tags).toEqual(["local"]);
 expect(documentSnapshotFromYDoc(doc).content.assets).toEqual([{id:"local",kind:"file",src:"local"}]);
 expect(documentSnapshotFromYDoc(peer)).toEqual(documentSnapshotFromYDoc(doc));
 doc.destroy();peer.destroy();
});

it.each(["work bound", "schema limit"])("preserves the complete ledger before mutating any field when the %s needs recovery",(reason)=>{
 const initial=snapshot("a".repeat(1500)),local=snapshot("b".repeat(1500)),remote=snapshot("c".repeat(1500));
 local.content.title="Local title";
 if (reason === "schema limit") {
   initial.content.body=local.content.body=remote.content.body="body";
   initial.content.title="x".repeat(19999);
   local.content.title=initial.content.title+"L";
   remote.content.title=initial.content.title+"R";
 }
 const doc=new Y.Doc();applyDocumentSnapshot(doc,remote);
 const ledger={current:local};const preserveRecovery=vi.fn();
 const source=editor.slice(editor.indexOf("      const localBeforeReady ="),editor.indexOf("      readyRef.current = true;"));
 compile(`function run(){${source}};run();`,"undefined",{doc,requireDocumentSnapshot:validateDocumentSnapshot,preReadyLocalRef:ledger,documentRef:{current:local},initialDocumentRef:{current:initial},hasDocumentSnapshot,applyDocumentBaseline,documentSnapshotFromYDoc,documentText,replaceYText,localOrigin:{current:{}},overlayPreReadyEdits,applyDocumentSnapshot,applyPreReadyMetadata,preReadyTextOperations,applyPreReadyTextOperations,publishDocument:vi.fn(),preserveRecovery,provider:{learnedEpoch:5}});
 expect(preserveRecovery).toHaveBeenCalledExactlyOnceWith(5);
 expect(ledger.current).toEqual(local);
 expect(documentSnapshotFromYDoc(doc)).toEqual(remote);
 doc.destroy();
});

it("replays varied repeated-character edits exactly when remote has not changed",()=>{
 let seed=8191;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let trial=0;trial<250;trial++){
  const base=Array.from({length:30},()=>"abc "[random()%4]).join("");
  let local=base;
  for(let edit=0;edit<6;edit++){
   const at=random()%(local.length+1);
   local=local.slice(0,at)+(random()%2?"X":"")+local.slice(at+(random()%3));
  }
  const doc=new Y.Doc(),target=doc.getText("probe");target.insert(0,base);
  applyPreReadyTextOperations(target,preReadyTextOperations(base,local,base),"local");
  expect(target.toString()).toBe(local);doc.destroy();
 }
});


it("preserves an unreconciled ledger when unmounted during catch-up",()=>{
 const start=editor.indexOf("    return () => {",editor.indexOf("    const handlePageHide ="));
 const end=editor.indexOf("\n  }, [",start);
 const preserveRecovery=vi.fn(),destroy=vi.fn(),doc=new Y.Doc();
 const cleanup=compile(`let cancelled=false;${editor.slice(start,end)}`,"undefined",{
   window:{removeEventListener:vi.fn()},handlePageHide:vi.fn(),awareness:{off:vi.fn()},handleAwareness:vi.fn(),
   doc,handleDocumentUpdate:vi.fn(),materializeTimerRef:{current:null},flushMaterialization:vi.fn(),
   readyRef:{current:false},preReadyLocalRef:{current:snapshot("LOCAL BEFORE READY")},preserveRecovery,
   provider:{learnedEpoch:5,destroy},providerRef:{current:null},
 });
 cleanup();
 expect(preserveRecovery).toHaveBeenCalledExactlyOnceWith(5);
 expect(destroy).toHaveBeenCalledOnce();doc.destroy();
});
