import { describe, expect, it, vi } from 'vitest';
import { openWebWorkspace } from './web-workspace-open';
const current='11111111-1111-4111-8111-111111111111', target='22222222-2222-4222-8222-222222222222';
function fixture() {
 const controller=new AbortController();
 const request=vi.fn().mockResolvedValueOnce(Response.json({workspaces:[{id:target}]})).mockResolvedValueOnce(Response.json({}));
 return { controller, options:{currentId:current,signal:controller.signal,request:request as typeof fetch,flush:vi.fn().mockResolvedValue(true),stopAgent:vi.fn(),navigate:vi.fn()},request };
}
describe('workspace switch boundary',()=>{
 it('rejects caller URLs and roots before saving or network access',async()=>{
  const {options,request}=fixture();
  for(const params of [{workspaceId:target,url:'https://elsewhere.test'},{workspaceId:'../outside'},{workspaceId:target,root:'/tmp'}]) await expect(openWebWorkspace(params,options)).rejects.toThrow('Choose a workspace');
  expect(options.flush).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 });
 it('does not act on a permission response arriving after the old workspace closed',async()=>{
  const {options,request,controller}=fixture();
  request.mockReset().mockImplementation(async()=>{controller.abort();return Response.json({workspaces:[{id:target}]});});
  await expect(openWebWorkspace({workspaceId:target},options)).rejects.toThrow();
  expect(options.stopAgent).not.toHaveBeenCalled();expect(options.navigate).not.toHaveBeenCalled();
 });
 it('refuses a revoked discovery entry without touching the active agent',async()=>{
  const {options,request}=fixture();request.mockReset().mockResolvedValue(Response.json({workspaces:[]}));
  await expect(openWebWorkspace({workspaceId:target},options)).rejects.toThrow('no longer available');
  expect(request).toHaveBeenCalledTimes(1);expect(options.stopAgent).not.toHaveBeenCalled();
 });
 it('keeps the current workspace a no-op',async()=>{
  const {options,request}=fixture();await openWebWorkspace({workspaceId:current},options);expect(request).not.toHaveBeenCalled();expect(options.flush).not.toHaveBeenCalled();
 });
});
