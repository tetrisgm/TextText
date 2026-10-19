import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const main=read('TextText.Windows/MainWindow.cs');
const scope=read('TextText.Windows/PrivateActorWorkspace.cs');
const stress=read('TextText.LiveAcceptance/Stress.cs');
function withoutPrivate(text) { return text.replace(/^#if TEXTTEXT_STRESS_ACTOR\r?\n([\s\S]*?)^#endif\r?$/gm,(_,body)=>body.includes('\n#else\n')?body.split('\n#else\n')[1]:''); }
test('normal source excludes private root and retains normal startup/root lookup',()=>{
 const normal=withoutPrivate(main);assert.doesNotMatch(normal,/PrivateActorWorkspace|privateActorWorkspace|PrepareVerified/);assert.match(normal,/var nextRoot = selectedRoot \?\? WorkspaceRoot\(active.WorkspaceId\)/);assert.match(normal,/selectedWorkspace = WorkspaceSelection.Load\(account.WorkspaceId\)/);
 assert.match(scope,/^#if TEXTTEXT_STRESS_ACTOR\n/);assert.match(scope,/#endif\s*$/);
 assert.match(read('TextText.Windows/TextText.Windows.csproj'),/Condition="'\$\(TextTextStressActor\)' == 'true'"/);
 assert.match(read('TextText.LiveAcceptance/TextText.LiveAcceptance.csproj'),/AdditionalProperties="TextTextStressActor=true"/);
 assert.match(read('TextText.Windows/TextText.Windows.csproj'),/GlobalPropertiesToRemove="TextTextStressActor"/);
});
test('private startup verifies real account and authorization before publication without credential or selection saves',()=>{
 const begin=main.indexOf('if(privateActorWorkspace is {} isolated)');const end=main.indexOf('\n#endif',begin);const startup=main.slice(begin,end);
 const tokens=['AccountIdentity.ResolveAsync','directory.AuthorizeAsync','isolated.PrepareVerified','OpenWorkspace(isolated.Root','isolated.VerifyPublished','isolated.Ready.TrySetResult'];let prior=-1;for(const token of tokens){const next=startup.indexOf(token);assert.ok(next>prior,token);prior=next;}
 assert.doesNotMatch(startup,/CredentialStore.Save|WorkspaceSelection.Save|LocationFile|ReviewRetainedWork/);assert.match(main,/if\(privateActorWorkspace is not null\)throw;/);
});
test('isolation waits for production readiness before identity validation and file activation',()=>{
 const start=stress.indexOf('await isolated.Ready.Task');const end=stress.indexOf('await runner.Loop',start);const bootstrap=stress.slice(start,end);let before=-1;for(const token of ['isolated.Ready.Task','bridge.InvokeAsync("files.ready"','isolated.VerifyFixture()','window.ActivateFiles']){const at=bootstrap.indexOf(token);assert.ok(at>before,token);before=at;}
 const projectionGuard=bootstrap.indexOf('if(!File.Exists(config.File))return false');assert.ok(projectionGuard>=0&&projectionGuard<bootstrap.indexOf('bridge.InvokeAsync("files.ready"'));
 assert.match(scope,/FileMode.CreateNew/);assert.doesNotMatch(scope,/AccountRootOwnership.Publish|AdoptAfterExplicitReview|CredentialStore|WorkspaceSelection/);
});
test('isolated actor refuses root/workspace/sign-in changes before UI or persistent effects',()=>{
 const workspace=read('TextText.Windows/MainWindow.Workspace.cs');
 assert.doesNotMatch(withoutPrivate(workspace),/privateActorWorkspace/);
 for(const [method,effect] of [['private async Task SwitchWorkspace','parameters.ValueKind'],['public async Task ChooseWorkspaceFolder','new Microsoft.Win32.OpenFolderDialog']]) {
  const begin=workspace.indexOf(method),guard=workspace.indexOf('if(privateActorWorkspace is not null)throw',begin),next=workspace.indexOf(effect,begin);
  assert.ok(guard>begin&&guard<next,method);
 }
 const signout=main.slice(main.indexOf('case "native.signOut":'),main.indexOf('default: return bridge'));
 assert.ok(signout.indexOf('if(privateActorWorkspace is not null)throw')<signout.indexOf('MessageBox.Show'));
 assert.ok(signout.indexOf('if(privateActorWorkspace is not null)throw')<signout.indexOf('CredentialStore.Clear'));
});
