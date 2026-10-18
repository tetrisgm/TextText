// Ordinary external writer modes. No rename fallback for in-place writes.
import{openSync,closeSync,fstatSync,lstatSync,ftruncateSync,writeSync,fsyncSync,readFileSync,writeFileSync,renameSync,existsSync,unlinkSync}from'node:fs';
import{join}from'node:path';import{sha256,canonicalJSON}from'./identity-observation.mjs';
import{stableRead,readPack,validateIdentity,appendToPack,assetHashesOf}from'./file-adapter.mjs';
export function validateWriteSequence(edit,role){const s=edit?.fileWriteSequence;return !!s&&['mac-cli','pc-cli'].includes(role)&&new RegExp('^r[0-9]{1,5}-'+role+'$').test(edit.id)&&edit.op==='append'&&['atomic','in-place'].includes(s.mode)&&Array.isArray(s.chunks)&&s.chunks.length>=1&&s.chunks.length<=8&&new Set(s.chunks).size===s.chunks.length&&s.chunks.every(text=>typeof text==='string'&&text.length>0&&text.length<=160&&!/[\r\n]/.test(text))&&s.chunks.join('')===edit.text&&Number.isInteger(s.intervalMs)&&s.intervalMs>=10&&s.intervalMs<=250;}
export function checkWriteProgress(edit,role,progress,complete=true){
 if(!edit.fileWriteSequence)return progress===undefined;
 if(!validateWriteSequence(edit,role)||!progress||progress.editId!==edit.id||progress.mode!==edit.fileWriteSequence.mode||!Array.isArray(progress.writes)||progress.writes.length>edit.fileWriteSequence.chunks.length||(complete&&progress.writes.length!==edit.fileWriteSequence.chunks.length))return false;
 let previous=-1;
 for(const[index,write]of progress.writes.entries()){if(write.ordinal!==index+1||write.suboperationId!==edit.id+'-write'+(index+1)||write.text!==edit.fileWriteSequence.chunks[index]||write.fsynced!==true||write.afterSha256!==write.readBackSha256||!['beforeSha256','afterSha256','readBackSha256','beforeFileIdentity','afterFileIdentity','assetDigest'].every(key=>/^[a-f0-9]{64}$/.test(write[key]??''))||write.unchangedAssets!==true||(progress.mode==='in-place'&&write.beforeFileIdentity!==write.afterFileIdentity)||(progress.mode==='atomic'&&write.beforeFileIdentity===write.afterFileIdentity)||!Number.isFinite(write.elapsedMs)||write.elapsedMs<=previous||write.elapsedMs>30000||(index>0&&write.elapsedMs-previous<edit.fileWriteSequence.intervalMs))return false;previous=write.elapsedMs;}
 if(progress.acceptedPrefix!==edit.fileWriteSequence.chunks.slice(0,progress.writes.length).join(''))return false;
 const attempted=progress.attemptedWrite;if(attempted!==undefined&&(complete||attempted.ordinal!==progress.writes.length+1||attempted.suboperationId!==edit.id+'-write'+(progress.writes.length+1)||attempted.text!==edit.fileWriteSequence.chunks[progress.writes.length]||!['prepared','opened','truncated','writing','fsynced','readback'].includes(attempted.phase)))return false;
 return true;
}
function identity(stat){if(!stat.isFile()||stat.ino===0n)throw new Error('Ordinary file identity unavailable');return sha256(stat.dev+':'+stat.ino);}
function fileStat(file){const stat=lstatSync(file,{bigint:true});if(stat.isSymbolicLink())throw new Error('Ordinary writer refuses symlink');return stat;}
function assets(bytes){const pack=readPack(bytes),paths=pack.entries.filter(entry=>entry.name.startsWith(pack.root+'assets/')&&!entry.name.endsWith('/')).map(entry=>entry.name.slice(pack.root.length));if(paths.length>32)throw new Error('Fixture asset inventory exceeds bound');return assetHashesOf(pack,paths);}
export async function applyWriteSequence({file,config,edit,round,runDir,progress,guard=()=>{},journal=()=>{},beforeMutation=()=>{},afterTruncate=()=>{},now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 if(!validateWriteSequence(edit,config.role))throw new Error('Invalid bounded file write sequence');
 const start=now();
 for(const[index,text]of edit.fileWriteSequence.chunks.entries()){
  if(index>0)await sleep(edit.fileWriteSequence.intervalMs);
  if(now()-start>=30000)throw new Error('File write sequence deadline exceeded');
  const ordinal=index+1,suboperationId=edit.id+'-write'+ordinal;
  progress.attemptedWrite={ordinal,suboperationId,text,phase:'prepared'};
  let receipt;
  for(let attempt=1;attempt<=5;attempt++){
   guard();const before=await stableRead(file);const original=validateIdentity(readPack(before),config);if(original.body.includes(text))throw new Error('File write marker already present');const beforeSha256=sha256(before),beforeFileIdentity=identity(fileStat(file)),next=appendToPack(before,config,text),afterSha256=sha256(next),beforeAssets=assets(before);
   validateIdentity(readPack(next),config);
   const backup=join(runDir,`${config.role}-r${round}-write${ordinal}-a${attempt}-before.textpack`);writeFileSync(backup,before,{flag:'wx'});
   let fd,temp,mutated=false;
   try{
    if(edit.fileWriteSequence.mode==='atomic'){temp=file+`.${process.pid}.${round}.${ordinal}.${attempt}.write.tmp`;fd=openSync(temp,'wx');}
    else{fd=openSync(file,'r+');if(identity(fstatSync(fd,{bigint:true}))!==beforeFileIdentity||sha256(readFileSync(fd))!==beforeSha256)throw new Error('precondition');}
    progress.attemptedWrite.phase='opened';await beforeMutation({ordinal,attempt});guard();
    if(identity(fileStat(file))!==beforeFileIdentity||sha256(readFileSync(file))!==beforeSha256){journal({event:'write-retry',round,ordinal,attempt});continue;}
    if(edit.fileWriteSequence.mode==='in-place'){ftruncateSync(fd,0);mutated=true;progress.attemptedWrite.phase='truncated';await afterTruncate({ordinal,attempt});}
    progress.attemptedWrite.phase='writing';progress.attemptedWrite.bytesWritten=0;let offset=0;while(offset<next.length){const wrote=writeSync(fd,next,offset,next.length-offset,offset);if(wrote<=0)throw new Error('Ordinary write made no progress');offset+=wrote;progress.attemptedWrite.bytesWritten=offset;}
    fsyncSync(fd);progress.attemptedWrite.phase='fsynced';closeSync(fd);fd=undefined;
    if(temp){guard();if(identity(fileStat(file))!==beforeFileIdentity||sha256(readFileSync(file))!==beforeSha256){journal({event:'write-retry',round,ordinal,attempt});continue;}renameSync(temp,file);temp=undefined;mutated=true;}
    progress.attemptedWrite.phase='readback';const readBackIdentity=identity(fileStat(file)),readBack=readFileSync(file),readBackSha256=sha256(readBack),afterFileIdentity=identity(fileStat(file));guard();
    if(readBackIdentity!==afterFileIdentity)throw new Error('Uncertain readback file identity');
    if(readBackSha256!==afterSha256||(edit.fileWriteSequence.mode==='in-place'&&afterFileIdentity!==beforeFileIdentity)||(edit.fileWriteSequence.mode==='atomic'&&afterFileIdentity===beforeFileIdentity)||canonicalJSON(assets(readBack))!==canonicalJSON(beforeAssets))throw new Error('Uncertain ordinary write readback or asset identity');
    validateIdentity(readPack(readBack),config);
    const elapsedMs=now()-start;if(elapsedMs>30000)throw new Error('File write sequence deadline exceeded');
    receipt={ordinal,suboperationId,text,beforeSha256,afterSha256,readBackSha256,beforeFileIdentity,afterFileIdentity,fsynced:true,unchangedAssets:true,assetDigest:sha256(canonicalJSON(beforeAssets)),elapsedMs};break;
   }catch(error){if(!mutated&&error.message==='precondition'){journal({event:'write-retry',round,ordinal,attempt});continue;}throw error;}
   finally{if(fd!==undefined)closeSync(fd);if(temp&&existsSync(temp))unlinkSync(temp);}
  }
  if(!receipt)throw new Error('Ordinary writer precondition remained contended; backups retained');
  progress.writes.push(receipt);progress.acceptedPrefix+=text;delete progress.attemptedWrite;journal({event:'write-accepted',round,...receipt});
 }
 return progress;
}
