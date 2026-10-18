// Ordinary external-tool directory rename and readonly evidence. Never invokes
// a TextText writer. All paths stay inside one fresh, explicitly owned fixture.
import {lstatSync,readdirSync,readFileSync,realpathSync,renameSync,writeFileSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {sha256,canonicalJSON} from './identity-observation.mjs';
const FOLDER=/^Six-client acceptance folder [a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const PROOF_KEYS=['version','kind','operationId','phase','source','destination','itemId','relativePath','folderIdentity','archiveSha256','folders'];
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
export function validateFolderCase(value){
 if(!value||Object.keys(value).some(key=>!['role','round','source','destination','emptyDescendants'].includes(key))||!['mac-cli','pc-cli'].includes(value.role)||value.round!==1||!FOLDER.test(value.source??'')||!FOLDER.test(value.destination??'')||value.source===value.destination||value.source.toLowerCase()!==value.destination.toLowerCase()||!Array.isArray(value.emptyDescendants)||value.emptyDescendants.length>8||new Set(value.emptyDescendants).size!==value.emptyDescendants.length||value.emptyDescendants.some(path=>typeof path!=='string'||path.split('/').some(part=>!/^[A-Za-z][A-Za-z0-9 -]{0,63}$/.test(part))))throw Error('folderCaseMove requires one CLI, round1, one owned UUID folder case change and bounded empty descendants');
 const paths=new Set(value.emptyDescendants);
 for(const path of paths){const at=path.lastIndexOf('/');if(at>=0&&!paths.has(path.slice(0,at)))throw Error('folderCaseMove must declare every empty descendant ancestor');}
 return {...value,emptyDescendants:[...paths].sort()};
}
export function folderRequest(value){
 if(!value||Object.keys(value).some(key=>!['operationId','phase','scenario'].includes(key))||!/^fc-[a-f0-9]{32}$/.test(value.operationId??'')||!['before','after'].includes(value.phase))throw Error('Invalid folder observation request');
 return {...value,scenario:validateFolderCase(value.scenario)};
}
function stamp(path){const stat=lstatSync(path,{bigint:true});if(stat.isSymbolicLink())throw Error('Linked folder fixture entry refused');return{stat,id:`${stat.dev}:${stat.ino}`,key:[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':')};}
function exactDirectory(root,parts){let current=root;for(const part of parts){if(!readdirSync(current).includes(part)){const error=Error('Exact folder fixture spelling unavailable');error.code='FOLDER_PENDING';throw error;}current=join(current,part);const s=stamp(current);if(!s.stat.isDirectory())throw Error('Folder fixture ancestor is not a directory');}return current;}
export function inspectOwnedFolder(config,request){
 const {operationId,phase,scenario}=folderRequest(request),root=realpathSync(config.workspaceRoot),name=phase==='before'?scenario.source:scenario.destination;
 if(config.title!==basename(config.file,'.textpack')||!config.title.startsWith('Six-client acceptance '))throw Error('Dedicated fixture title mismatch');
 const original=resolve(config.workspaceRoot,scenario.source,config.title+'.textpack'),target=resolve(config.file);
 if(target!==original&&target!==resolve(config.workspaceRoot,scenario.destination,config.title+'.textpack'))throw Error('Fixture file is not under the owned test folder');
 const folder=exactDirectory(root,[name]),rootNames=readdirSync(root),other=phase==='before'?scenario.destination:scenario.source;
 if(rootNames.includes(other))throw Error('Both exact folder spellings are present');
 const folderStamp=stamp(folder),expectedDirectories=scenario.emptyDescendants,expectedFiles=[config.title+'.textpack'];
 const directories=[],files=[];
 const scan=(at,prefix='')=>{for(const leaf of readdirSync(at).sort()){const path=prefix?prefix+'/'+leaf:leaf,full=join(at,leaf),entry=stamp(full);if(entry.stat.isDirectory()){directories.push(path);if(!expectedDirectories.includes(path))throw Error('Unknown folder fixture directory preserved');scan(full,path);}else if(entry.stat.isFile()){if(!expectedFiles.includes(path)||entry.stat.size>64n*1024n*1024n)throw Error('Unknown folder fixture file preserved');const bytes=readFileSync(full);if(stamp(full).key!==entry.key||BigInt(bytes.length)!==entry.stat.size)throw Error('Folder fixture file changed during inspection');files.push({path,sha256:sha256(bytes)});}else throw Error('Unsupported folder fixture entry preserved');}};
 scan(folder);
 if(!equal(directories.sort(),expectedDirectories)||!equal(files.map(row=>row.path).sort(),expectedFiles))throw Error('Folder fixture membership changed');
 if(stamp(folder).id!==folderStamp.id)throw Error('Folder fixture identity changed during inspection');
 return{version:1,kind:'filesystem',operationId,phase,source:scenario.source,destination:scenario.destination,itemId:config.itemId,relativePath:name+'/'+config.title+'.textpack',folderIdentity:folderStamp.id,archiveSha256:files[0].sha256,folders:[name,...directories.map(path=>name+'/'+path)].sort()};
}
export function validateFolderProof(proof,config,request){
 const {operationId,phase,scenario}=folderRequest(request),name=phase==='before'?scenario.source:scenario.destination;
 if(!proof||Object.keys(proof).length!==PROOF_KEYS.length||!PROOF_KEYS.every(key=>Object.hasOwn(proof,key))||proof.version!==1||!['filesystem','manifest'].includes(proof.kind)||proof.operationId!==operationId||proof.phase!==phase||proof.source!==scenario.source||proof.destination!==scenario.destination||proof.itemId!==config.itemId||proof.relativePath!==name+'/'+config.title+'.textpack'||!digest(proof.archiveSha256)||!equal(proof.folders,[name,...scenario.emptyDescendants.map(p=>name+'/'+p)].sort())||(proof.kind==='manifest'&&proof.folderIdentity!==null)||(proof.kind==='filesystem'&&(typeof proof.folderIdentity!=='string'||!/^\d+:\d+$/.test(proof.folderIdentity))))throw Error('Folder path/content proof is incomplete or mismatched');
 return proof;
}
export function compareFolderProof(before,after){
 if(before.kind!==after.kind||before.archiveSha256!==after.archiveSha256||(before.kind==='filesystem'&&before.folderIdentity!==after.folderIdentity))throw Error('Folder case mutation changed archive bytes or directory identity');
}
export function moveOwnedFolder(config,request,{guard=()=>{},afterGuard=guard,runDir}={}){
 const checked=folderRequest({...request,phase:'before'});guard();const before=inspectOwnedFolder(config,checked);
 const root=realpathSync(config.workspaceRoot),source=join(root,checked.scenario.source),destination=join(root,checked.scenario.destination);
 try{const peer=stamp(destination);if(peer.id!==before.folderIdentity)throw Error('Distinct destination preserved');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!runDir)throw Error('Retained fixture evidence directory required');
 const archive=readFileSync(join(source,config.title+'.textpack'));if(sha256(archive)!==before.archiveSha256)throw Error('Folder fixture archive changed before rename');
 for(const [name,bytes]of [[checked.operationId+'-before.textpack',archive],[checked.operationId+'-before.json',Buffer.from(JSON.stringify(before))]]){const path=join(runDir,name);writeFileSync(path,bytes,{flag:'wx'});const fd=openSync(path,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}}
 guard();const final=inspectOwnedFolder(config,checked);if(!equal(final,before))throw Error('Folder fixture changed before rename');
 // Node's ordinary rename is not an arbitrary external-writer race guarantee.
 // The operation is restricted to this one owned tree; never infer/prune peers.
 renameSync(source,destination);
 const after=inspectOwnedFolder(config,{...checked,phase:'after'});compareFolderProof(before,after);afterGuard();
 const result={operationId:checked.operationId,before,after,retainedEvidence:true};writeFileSync(join(runDir,checked.operationId+'-after.json'),JSON.stringify(result),{flag:'wx'});return result;
}

export function observeOwnedFolder(config,request){
 const checked=folderRequest(request);
 try{return {proof:inspectOwnedFolder(config,checked),pending:false};}
 catch(error){if(checked.phase!=='after'||error.code!=='FOLDER_PENDING')throw error;return {proof:inspectOwnedFolder(config,{...checked,phase:'before'}),pending:true};}
}
export function observeManifestFolder(config,request,manifest){
 const checked=folderRequest(request),s=checked.scenario;
 if(!manifest||!Array.isArray(manifest.folders)||manifest.folders.length>20000||!Array.isArray(manifest.items)||manifest.items.length>40000||!Array.isArray(manifest.problems)||manifest.problems.some(p=>[s.source,s.destination].some(name=>p.relativePath===name||p.relativePath?.startsWith(name+'/'))))throw Error('Authenticated folder manifest is ambiguous');
 let phase=checked.phase,pending=false;
 if(phase==='after'&&!manifest.folders.includes(s.destination)&&manifest.folders.includes(s.source)){phase='before';pending=true;}
 const name=phase==='before'?s.source:s.destination,other=phase==='before'?s.destination:s.source,children=manifest.items.filter(i=>i.relativePath?.startsWith(name+'/'));
 if(manifest.folders.includes(other)||children.length!==1||children[0].itemId!==config.itemId)throw Error('Folder manifest changed its fixture membership');
 const proof=validateFolderProof({version:1,kind:'manifest',operationId:checked.operationId,phase,source:s.source,destination:s.destination,itemId:config.itemId,relativePath:children[0].relativePath,folderIdentity:null,archiveSha256:children[0].revision,folders:manifest.folders.filter(p=>p===name||p.startsWith(name+'/')).sort()},config,{...checked,phase});
 return {proof,pending};
}
