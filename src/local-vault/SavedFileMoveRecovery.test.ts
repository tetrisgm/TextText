import { expect, it } from "vitest";
import { validateSavedFileMoveRecovery } from "./SavedFileMoveRecovery";
const row = {id:"11111111-1111-4111-8111-111111111111",itemId:"22222222-2222-4222-8222-222222222222",sourcePath:"Notes/First.textpack",destinationPath:"Notes/Second.textpack",requestHash:"a".repeat(64),state:"pending",localPath:"Notes/Second.textpack",remotePath:"Notes/First.textpack",inspection:"b".repeat(64),retryAllowed:true,keepNamesAllowed:false,blockedReason:null};
it("accepts only the independently permitted recovery action for each phase", () => {
  expect(validateSavedFileMoveRecovery(row)).toEqual(row);
  expect(validateSavedFileMoveRecovery({...row,state:"terminal-rejected",retryAllowed:false,keepNamesAllowed:true})).toMatchObject({keepNamesAllowed:true});
  expect(validateSavedFileMoveRecovery({...row,state:"stopped",retryAllowed:false})).toMatchObject({state:"stopped"});
  expect(validateSavedFileMoveRecovery({...row,state:"review",requestHash:null,inspection:null,retryAllowed:false,blockedReason:"ambiguous"})).toMatchObject({state:"review"});
});
it("rejects malformed identity, paths, tokens, unknown reasons and phase action escalation", () => {
  for (const value of [null,[],{}, {...row,future:true},{...row,id:"other"},{...row,itemId:"other"},
    {...row,sourcePath:"../Other.textpack"},{...row,destinationPath:row.sourcePath},{...row,localPath:"/absolute.textpack"},
    {...row,remotePath:"Notes\\Other.textpack"},{...row,requestHash:null},{...row,inspection:null},
    {...row,inspection:"b".repeat(64)+"\n"},{...row,requestHash:"a".repeat(64)+"\n"},
    {...row,blockedReason:"raw native error"},{...row,blockedReason:"checkpoint"},
    {...row,state:"review"},{...row,state:"stopped"},{...row,state:"terminal-rejected"},
    {...row,keepNamesAllowed:true},{...row,retryAllowed:"true"},{...row,localPath:null},{...row,remotePath:null}]) {
    expect(() => validateSavedFileMoveRecovery(value)).toThrow();
  }
});
it("retains exact Unicode path spelling and accepts unavailable read-only inspection", () => {
  const value = {...row,sourcePath:"Notes/Cafe\u0301.textpack",destinationPath:"Notes/Café.textpack",retryAllowed:false,localPath:null,remotePath:null,inspection:null,blockedReason:"unavailable"};
  expect(validateSavedFileMoveRecovery(value)).toEqual(value);
  expect(validateSavedFileMoveRecovery(value).sourcePath).not.toBe(value.destinationPath);
});
