import{beforeEach,expect,it,vi}from"vitest";
const mock=vi.hoisted(()=>({auth:vi.fn(),recover:vi.fn()}));
vi.mock("@/app/api/vault/scoped-auth",()=>({authorizeVaultWorkspaceOrScoped:mock.auth}));
vi.mock("@/lib/store",()=>({recoverVaultFolderCase:mock.recover}));
import{POST}from"./route";
const context={params:Promise.resolve({workspaceId:"workspace"})};
const command={operationId:"case-one",source:"Parent/Case",destination:"Parent/CASE",baseManifestRevision:"a".repeat(64),folders:["Parent/Case"],items:[]};
const request=(value:unknown)=>new Request("https://texttext.test/api/vault/workspace/folder-case-moves/recovery",{method:"POST",body:JSON.stringify(value)});
beforeEach(()=>{vi.resetAllMocks();mock.auth.mockResolvedValue({root:"/fixture",actorUserId:"owner",canManageShares:true,fullAccess:true});mock.recover.mockResolvedValue({state:"review",inspection:"b".repeat(64)});});
it("binds inspection and explicit fresh cancellation to current owner/root",async()=>{
 const response=await POST(request({action:"inspect",command}),context);expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");
 expect(mock.recover).toHaveBeenCalledWith(expect.objectContaining({...command,action:"inspect",root:"/fixture",actorUserId:"owner"}));
 const authorize=mock.recover.mock.calls[0][0].authorize;await authorize();mock.auth.mockResolvedValue({root:"/other",actorUserId:"owner",canManageShares:true,fullAccess:true});await expect(authorize()).rejects.toThrow("changed");
 mock.auth.mockResolvedValue({root:"/fixture",actorUserId:"owner",canManageShares:true,fullAccess:true});
 expect((await POST(request({action:"cancel",command,inspection:"b".repeat(64),consent:true}),context)).status).toBe(200);
});
it.each([
 {action:"cancel",command,inspection:"b".repeat(64)},
 {action:"cancel",command,inspection:"b".repeat(64),consent:false},
 {action:"inspect",command,consent:true},
 {action:"inspect",command:{...command,future:true}},
 {action:"inspect",command:{...command,destination:"Other/CASE"}},
 {action:"cancel",command,inspection:"bad",consent:true}
])("refuses missing consent, stale-shaped input and generalized moves",async value=>{expect((await POST(request(value),context)).status).toBe(400);expect(mock.recover).not.toHaveBeenCalled();});
it("preserves auth failures and refuses nonowner before storage",async()=>{mock.auth.mockResolvedValue(new Response(null,{status:401}));expect((await POST(request({action:"inspect",command}),context)).status).toBe(401);mock.auth.mockResolvedValue({actorUserId:"editor",canManageShares:false,fullAccess:true});expect((await POST(request({action:"inspect",command}),context)).status).toBe(403);expect(mock.recover).not.toHaveBeenCalled();});
it("returns uncertainty on recovery errors without granting cancellation",async()=>{mock.recover.mockRejectedValue(Error("private token"));const response=await POST(request({action:"cancel",command,inspection:"b".repeat(64),consent:true}),context);expect(response.status).toBe(409);expect(JSON.stringify(await response.json())).not.toContain("private token");});
