import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,renameSync,symlinkSync,lstatSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {validateFolderCase,inspectOwnedFolder,observeOwnedFolder,moveOwnedFolder,validateFolderProof,compareFolderProof,observeManifestFolder} from './folder-case.mjs';
const make=()=>{const root=mkdtempSync(join(tmpdir(),'texttext-owned-folder-unit-')),source='Six-client acceptance folder '+randomUUID(),destination=source.replace('folder','FOLDER'),title='Six-client acceptance fixture';mkdirSync(join(root,source,'Empty/Nested'),{recursive:true});writeFileSync(join(root,source,title+'.textpack'),Buffer.from([0,255,7]));const config={workspaceRoot:root,file:join(root,source,title+'.textpack'),title,itemId:'fixture'};const request={operationId:'fc-'+'a'.repeat(32),phase:'before',scenario:{role:'mac-cli',round:1,source,destination,emptyDescendants:['Empty','Empty/Nested']}};const runDir=join(root,'evidence');mkdirSync(runDir);return{root,config,request,runDir};};
test('ordinary owned folder case rename preserves inode, full archive, empty descendants and retained evidence',()=>{
 const f=make(),before=inspectOwnedFolder(f.config,f.request);const pending=observeOwnedFolder(f.config,{...f.request,phase:'after'});assert.equal(pending.pending,true);assert.deepEqual(pending.proof,before);
 const moved=moveOwnedFolder(f.config,f.request,{runDir:f.runDir});assert.equal(moved.before.folderIdentity,moved.after.folderIdentity);assert.equal(moved.before.archiveSha256,moved.after.archiveSha256);assert.deepEqual(moved.after.folders,[f.request.scenario.destination,...f.request.scenario.emptyDescendants.map(p=>f.request.scenario.destination+'/'+p)].sort());assert.ok(!readdirSync(f.root).includes(f.request.scenario.source));assert.ok(readdirSync(f.root).includes(f.request.scenario.destination));assert.deepEqual(readFileSync(join(f.runDir,f.request.operationId+'-before.textpack')),Buffer.from([0,255,7]));assert.equal(observeOwnedFolder(f.config,{...f.request,phase:'after'}).pending,false);
 validateFolderProof(moved.after,f.config,{...f.request,phase:'after'});assert.throws(()=>validateFolderProof({...moved.after,future:true},f.config,{...f.request,phase:'after'}));
});
test('unknown/linked children and occupied exact destination refuse without renaming or deleting any bytes',()=>{
 for(const kind of ['unknown-file','unknown-directory','linked-file','occupied-destination']){
  const f=make(),before=readFileSync(f.config.file);
  if(kind==='unknown-file')writeFileSync(join(f.root,f.request.scenario.source,'Keep.bin'),'preserve');
  if(kind==='unknown-directory')mkdirSync(join(f.root,f.request.scenario.source,'Undeclared'));
  if(kind==='linked-file')symlinkSync(f.config.file,join(f.root,f.request.scenario.source,'Link'));
  if(kind==='occupied-destination'){renameSync(join(f.root,f.request.scenario.source),join(f.root,f.request.scenario.destination));}
  assert.throws(()=>moveOwnedFolder(f.config,f.request,{runDir:f.runDir}));
  const folder=kind==='occupied-destination'?f.request.scenario.destination:f.request.scenario.source;assert.deepEqual(readFileSync(join(f.root,folder,f.config.title+'.textpack')),before);assert.deepEqual(readdirSync(f.runDir),[]);
 }
});
test('scope rejects Notes, workspace, path traversal, different leaf, undeclared ancestry and foreign file',()=>{
 const f=make();for(const change of [{source:'Notes',destination:'notes'},{source:'.',destination:'ROOT'},{destination:'Other'},{source:'../'+f.request.scenario.source},{emptyDescendants:['Empty/Nested']},{future:true}])assert.throws(()=>validateFolderCase({...f.request.scenario,...change}));
 assert.throws(()=>inspectOwnedFolder({...f.config,file:join(f.root,'Notes',f.config.title+'.textpack')},f.request));
});
test('changed bytes/inode and mismatched authenticated catalog cannot satisfy path-only accounting',()=>{
 const f=make(),before=inspectOwnedFolder(f.config,f.request);assert.throws(()=>compareFolderProof(before,{...before,archiveSha256:'b'.repeat(64)}));assert.throws(()=>compareFolderProof(before,{...before,folderIdentity:'9:9'}));
 const s=f.request.scenario,manifest={folders:before.folders,items:[{itemId:f.config.itemId,relativePath:before.relativePath,revision:before.archiveSha256}],problems:[]};const observed=observeManifestFolder(f.config,f.request,manifest);assert.equal(observed.proof.kind,'manifest');assert.equal(observed.proof.folderIdentity,null);assert.equal(observeManifestFolder(f.config,{...f.request,phase:'after'},manifest).pending,true);
 for(const altered of [{...manifest,folders:[...manifest.folders,s.destination]},{...manifest,items:[...manifest.items,...manifest.items]},{...manifest,folders:manifest.folders.slice(1)},{...manifest,problems:[{relativePath:s.source+'/unknown',reason:'unsafe'}]}])assert.throws(()=>observeManifestFolder(f.config,f.request,altered));
});
