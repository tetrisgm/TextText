import { expect, it } from "vitest";
import { validateFolderSyncMoveRecovery } from "./FolderSyncMoveRecovery";
const command = {operationId:"case-one",source:"Notes",destination:"notes",baseManifestRevision:"a".repeat(64),folders:["Notes","Notes/Empty"],items:[{itemId:"one",relativePath:"Notes/one.textpack",revision:"b".repeat(64)}]};
const review = {id:"case-one",command,state:"review",requestHash:"c".repeat(64),expectedIdentity:"original",from:{present:false,identity:null},to:{present:true,identity:"original"},localInspection:"d".repeat(64),inspection:"e".repeat(64),manifestRevision:"f".repeat(64),folders:command.folders,items:command.items,result:null,resolutionBlocked:null};
const moved = {operationId:command.operationId,status:"moved",source:command.source,destination:command.destination,folders:["notes","notes/Empty"],items:[{...command.items[0],relativePath:"notes/one.textpack"}],manifestRevision:"f".repeat(64)};
it("accepts separately proven review, completed, cancelled and explicitly unverified rows",()=>{
 expect(validateFolderSyncMoveRecovery(review)).toEqual(review);
 expect(validateFolderSyncMoveRecovery({...review,state:"completed",inspection:null,manifestRevision:null,folders:null,items:null,result:moved})).toMatchObject({state:"completed"});
 expect(validateFolderSyncMoveRecovery({...review,state:"cancelled",folders:null,items:null})).toMatchObject({state:"cancelled"});
 expect(validateFolderSyncMoveRecovery({...review,state:"unavailable",requestHash:null,inspection:null,manifestRevision:null,folders:null,items:null,resolutionBlocked:"The server is unavailable."})).toMatchObject({state:"unavailable"});
});
it("refuses unknown, ambiguous, mismatched and falsely authoritative rows",()=>{
 for(const value of [null,[],{}, {...review,future:true},{...review,id:"other"},{...review,localInspection:"bad"},{...review,inspection:null},
 {...review,command:{...command,future:true}},{...review,command:{...command,destination:"Other/notes"}},{...review,command:{...command,folders:["Notes","Notes"]}},
 {...review,from:{present:false,identity:"foreign"}},{...review,to:{present:true,identity:null}},
 {...review,state:"unavailable"},{...review,state:"completed",inspection:null,manifestRevision:null,folders:null,items:null,result:{...moved,items:[]}},
 {...review,state:"completed",inspection:null,manifestRevision:null,folders:null,items:null,result:{...moved,future:true}},{...review,state:"cancelled"},{...review,folders:["../Notes"]},
 {...review,items:[{...command.items[0],future:true}]},{...review,requestHash:"c".repeat(64)+"\n"}])expect(()=>validateFolderSyncMoveRecovery(value)).toThrow();
});
