// Prepared activation only. Executes the exact JS return builders and actual
// disposable file-actor legacy/refusal paths; no browser or native process.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {zipSync,strToU8} from 'fflate';
import {createActor,validateActorConfig,TITLE_PREFIX} from './file-adapter.mjs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=join(dirname(fileURLToPath(import.meta.url)),'../..');
const manifest={roles:{'mac-app':'mac/Sources/TextText/NativeStressRunner.swift','pc-app':'windows/TextText.LiveAcceptance/Stress.cs'}};
const fixture={workspaceId:'11111111-1111-4111-8111-111111111111',itemId:'22222222-2222-4222-8222-222222222222'};
for(const role of ['mac-web','pc-web'])test('exact browser attestation builder '+role+' requires completed identity branch',()=>{const source=readFileSync(join(base,'sync/stress/browser-adapter.mjs'),'utf8');const expression=source.match(/return (\{ type: 'attest', round: 0, finiteSoakCorrelation:[^\n]+);/)[1];const build=new Function('config','platform','sessionId','identity','ADAPTER_NAME','hostname','isRestart','profile','generation','return '+expression);const args=[{...fixture,auth:'saved-app'},{role,browser:'controlled-no-launch'},'controlled-session',undefined,'browser-adapter',()=>role.startsWith('mac')?'mac':'pc',false,{created:true},1];const legacy=build(...args);assert.equal(legacy.binaryAssetObservation,undefined);args[3]={controlledVerifiedBranchInput:true};const verified=build(...args);assert.equal(verified.binaryAssetObservation,1);assert.equal(verified.identity,args[3]);delete verified.binaryAssetObservation;delete verified.identity;assert.deepEqual(verified,legacy);assert(source.indexOf('boundAccountId=accountId')<source.indexOf('return '+expression));assert(source.indexOf('observeSealedSource(config.identityReceipt')<source.indexOf('return '+expression));});
for(const role of ['mac-cli','pc-cli'])test('exact file attestation builder '+role+' leaves unsealed hello unadvertised',()=>{const source=readFileSync(join(base,'sync/stress/file-adapter.mjs'),'utf8');const start=source.indexOf("return { type: 'attest', round: 0, finiteSoakCorrelation:");const end=source.indexOf(' };',start);const expression=source.slice(start+7,end+2);const build=new Function('config','machineId','identity','initialPack','return '+expression);const legacy=build({...fixture,role},'controlled-machine',undefined,undefined);assert.equal(legacy.binaryAssetObservation,undefined);const identity={controlledVerifiedBranchInput:true},pack={controlledPack:true};const verified=build({...fixture,role},'controlled-machine',identity,pack);assert.equal(verified.binaryAssetObservation,1);assert.equal(verified.identity,identity);assert.equal(verified.initialPack,pack);assert(source.indexOf('state.ownerGuard() !== state.ownerScope')<start);assert(source.indexOf('validateIdentity(readPack(await stableRead(config.file))')<start);});
test('native prepared advertisement occurs only on successful source/principal identity branch',()=>{const mac=readFileSync(join(base,manifest.roles['mac-app']),'utf8'),pc=readFileSync(join(base,manifest.roles['pc-app']),'utf8');assert(mac.startsWith('#if TEXTTEXT_STRESS_ACTOR\n'));assert(mac.includes('result["identity"] = try observedIdentity(); result["binaryAssetObservation"] = 1'));assert.equal((mac.match(/binaryAssetObservation/g)??[]).length,1);assert.equal((pc.match(/binaryAssetObservation/g)??[]).length,1);const legacy=pc.indexOf('return new { type = "attest"',pc.indexOf('binaryAssetObservation'));assert(!pc.slice(legacy,pc.indexOf('case "prepare"',legacy)).includes('binaryAssetObservation'));});

const TITLE=TITLE_PREFIX+'2026-10-19',ITEM='item-abc123',WS='ws-fixture';
function disposable(){
 const dir=mkdtempSync(join(tmpdir(),'asset-capability-')),file=join(dir,TITLE+'.textpack'),root=TITLE+'.textbundle/';
 const document={schemaVersion:1,content:{title:TITLE,body:'Existing fixture text.\n',fields:{},tags:[]},template:{id:'texttext.note',version:1},presentation:{theme:{}}};
 const front='---\nschema: "texttext.markdown-file.v1"\nkind: "note"\ntitle: '+JSON.stringify(TITLE)+'\ntextTextId: '+JSON.stringify(ITEM)+'\nstatus: "draft"\n---\n\n';
 writeFileSync(file,zipSync({[root+'text.md']:strToU8(front+document.content.body),[root+'document.json']:strToU8(JSON.stringify(document)),[root+'info.json']:strToU8('{"version":2,"type":"net.daringfireball.markdown"}'),[root+'template.json']:strToU8('{"id":"texttext.note","version":1}'),[root+'net.texttext.projection.json']:strToU8('{"version":1,"itemId":"item-abc123"}')}));
 const receiptDir=join(dir,'receipts');mkdirSync(receiptDir);
 return {file,config:validateActorConfig({role:'mac-cli',file,workspaceId:WS,itemId:ITEM,title:TITLE,receiptDir,observeMaxMs:2000})};
}
for(const mode of ['legacy','foreign-platform','misplaced-proof','forged-identity'])test('actual disposable file hello/refusal '+mode,async()=>{
 const f=disposable(),before=readFileSync(f.file),actor=createActor(f.config,{platform:mode==='foreign-platform'?'win32':'darwin'});
 const message={type:'hello',role:'mac-cli',mode:'real',runId:'capability-'+mode,fixture:{workspaceId:WS,itemId:ITEM},...(mode==='forged-identity'?{identitySchema:1,identity:{forged:true}}:{})};
 const hello=await actor.handle(message);assert.equal(hello.binaryAssetObservation,undefined);
 assert.equal(hello.type,['foreign-platform','forged-identity'].includes(mode)?'error':'attest');
 if(mode==='misplaced-proof'){const result=await actor.handle({type:'prepare',round:1,assetProof:{version:1,sampleId:'12345678-1234-1234-1234-123456789abc'},edit:{id:'r1-mac-cli',op:'append',text:'never'}});assert.equal(result.type,'error');assert.equal(result.binaryAssetObservation,undefined);}
 assert.deepEqual(readFileSync(f.file),before);
});
