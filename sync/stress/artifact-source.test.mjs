import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, readFileSync, copyFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, preparePristineSource, verifySourceTree, fixedArtifactPaths, createOnlyJSON, verifyBuildSteps, requiredBuildSteps, wrapperHashes, artifactHashes, sealArtifacts } from './artifact-source.mjs';
function sourceFixture() {
  const dir=mkdtempSync(join(tmpdir(),'texttext-source-proof-')),repo=join(dir,'repository');mkdirSync(repo);
  command('git',['init','--quiet'],repo,{capture:true});
  writeFileSync(join(repo,'source.mjs'),'committed source\n');
  writeFileSync(join(repo,'executable.sh'),'#!/bin/sh\nexit 0\n');chmodSync(join(repo,'executable.sh'),0o755);
  command('git',['add','source.mjs','executable.sh'],repo,{capture:true});
  command('git',['-c','user.name=Source proof fixture','-c','user.email=source-proof@example.invalid','commit','--quiet','-m','source fixture'],repo,{capture:true});
  return {dir,repo};
}
test('pristine archive ignores dirty working checkout and verifies exact source bytes and executable mode',()=>{
  const {dir,repo}=sourceFixture();
  writeFileSync(join(repo,'source.mjs'),'unrelated dirty working tree');
  const prepared=preparePristineSource(repo,'HEAD',join(dir,'fresh'));
  assert.equal(readFileSync(join(prepared.sourceRoot,'source.mjs'),'utf8'),'committed source\n');
  assert.equal(verifySourceTree(repo,prepared.proof.sourceCommit,prepared.sourceRoot).sourceInputSha256,prepared.proof.sourceInputSha256);
  writeFileSync(join(prepared.sourceRoot,'source.mjs'),'changed after build');
  assert.throws(()=>verifySourceTree(repo,prepared.proof.sourceCommit,prepared.sourceRoot),/differs/);
  assert.throws(()=>preparePristineSource(repo,'HEAD',join(dir,'fresh')),/exist/i);
});
test('changed tracked executable mode fails source proof',()=>{
  const {dir,repo}=sourceFixture(),prepared=preparePristineSource(repo,'HEAD',join(dir,'fresh'));
  chmodSync(join(prepared.sourceRoot,'executable.sh'),0o644);
  if(process.platform!=='win32') assert.throws(()=>verifySourceTree(repo,prepared.proof.sourceCommit,prepared.sourceRoot),/mode/);
});
test('tracked symlink content is verified and escaping links are rejected',()=>{
  if(process.platform==='win32') return;
  const {dir,repo}=sourceFixture();symlinkSync('source.mjs',join(repo,'source-link'));
  command('git',['add','source-link'],repo,{capture:true});
  command('git',['-c','user.name=Source proof fixture','-c','user.email=source-proof@example.invalid','commit','--quiet','-m','link fixture'],repo,{capture:true});
  const prepared=preparePristineSource(repo,'HEAD',join(dir,'valid'));
  assert.equal(verifySourceTree(repo,prepared.proof.sourceCommit,prepared.sourceRoot).files,3);
  symlinkSync('../outside',join(repo,'outside-link'));
  command('git',['add','outside-link'],repo,{capture:true});
  command('git',['-c','user.name=Source proof fixture','-c','user.email=source-proof@example.invalid','commit','--quiet','-m','escaping fixture'],repo,{capture:true});
  assert.throws(()=>preparePristineSource(repo,'HEAD',join(dir,'invalid')),/leaves pristine/);
});
test('artifact mapping is fixed per role and receipts are create-only',()=>{
  const {dir}=sourceFixture();
  assert.match(fixedArtifactPaths('mac-app',dir).nativeExecutable,/mac\/build\/TextText.app\/Contents\/MacOS\/TextText$/);
  assert.match(fixedArtifactPaths('pc-app',dir).core,/windows\/build\/stress-actor\/TextText.Core.dll$/);
  assert.throws(()=>fixedArtifactPaths('wrong-role',dir),/Unknown/);
  const receipt=join(dir,'receipt.json');createOnlyJSON(receipt,{status:'first'});
  assert.throws(()=>createOnlyJSON(receipt,{status:'second'}),/exist/i);
  assert.equal(JSON.parse(readFileSync(receipt)).status,'first');
});

test('untracked compilation source cannot hide outside tracked source proof',()=>{
  const {dir,repo}=sourceFixture(),prepared=preparePristineSource(repo,'HEAD',join(dir,'fresh'));
  mkdirSync(join(prepared.sourceRoot,'mac/Sources'),{recursive:true});writeFileSync(join(prepared.sourceRoot,'mac/Sources/Unexpected.swift'),'extra compilation input');
  assert.throws(()=>verifySourceTree(repo,prepared.proof.sourceCommit,prepared.sourceRoot),/Untracked source/);
});
test('build receipts require exact ordered steps with no omissions, duplicates or unknown commands',()=>{
  for(const role of ['mac-app','pc-app','mac-web','pc-cli']){
    const valid=requiredBuildSteps(role).map(id=>({id,status:'passed'}));assert.doesNotThrow(()=>verifyBuildSteps(role,valid));
    for(const bad of [valid.slice(1),[...valid,valid[0]],[...valid,{id:'arbitrary-command',status:'passed'}],valid.toReversed(),valid.map((step,index)=>index?step:{...step,status:'failed'})])
      assert.throws(()=>verifyBuildSteps(role,bad),/required steps/);
  }
});
test('sealer refuses changed produced artifacts and writes one immutable trusted local sidecar',()=>{
  if(process.platform!=='darwin') return;
  const {dir,repo}=sourceFixture(),here=new URL('./',import.meta.url);
  mkdirSync(join(repo,'sync/stress'),{recursive:true});
  for(const name of ['build-private-actor.mjs','seal-artifacts.mjs','artifact-source.mjs','identity-observation.mjs','identity.mjs','file-adapter.mjs','file-write-sequence.mjs','malformed-repair.mjs','multi-field-page.mjs','multi-field.mjs','multi-field-input.mjs','multi-field-pack.mjs','undo-redo.mjs']) copyFileSync(new URL(name,here),join(repo,'sync/stress',name));
  command('git',['add','sync'],repo,{capture:true});command('git',['-c','user.name=Source proof fixture','-c','user.email=source-proof@example.invalid','commit','--quiet','-m','wrapper fixture'],repo,{capture:true});
  const prepared=preparePristineSource(repo,'HEAD',join(dir,'candidate'));
  mkdirSync(join(prepared.sourceRoot,'node_modules/fflate/esm'),{recursive:true});writeFileSync(join(prepared.sourceRoot,'node_modules/fflate/esm/index.mjs'),'fixture dependency bytes');
  const receipt={schemaVersion:1,kind:'private-actor-build-source',status:'passed',role:'mac-cli',platform:process.platform,
    sourceRoot:prepared.sourceRoot,sourceCommit:prepared.proof.sourceCommit,before:prepared.proof,after:prepared.proof,
    sourceArchiveSha256:prepared.sourceArchiveSha256,provenance:'trusted-local-private-build-v1',wrapperHashes:wrapperHashes(prepared.sourceRoot),
    artifacts:artifactHashes('mac-cli',prepared.sourceRoot),steps:requiredBuildSteps('mac-cli').map(id=>({id,status:'passed'}))};
  const buildReceipt=join(dir,'build-receipt.json'),sidecar=join(dir,'StressBuildIdentity.json');createOnlyJSON(buildReceipt,receipt);
  const config={repository:repo,sourceRoot:prepared.sourceRoot,buildReceipt,sidecar};
  assert.equal(sealArtifacts(config).provenance,'trusted-local-private-build-v1');
  assert.throws(()=>sealArtifacts(config),/exist/i);
  writeFileSync(join(prepared.sourceRoot,'node_modules/fflate/esm/index.mjs'),'changed dependency bytes');
  assert.throws(()=>sealArtifacts({...config,sidecar:join(dir,'wrong.json')}),/artifacts changed/);
});

test('private archive has isolated clean Git identity and cannot change original refs or dirty files',()=>{
  const {dir,repo}=sourceFixture();
  const original=command('git',['rev-parse','HEAD'],repo,{capture:true});
  writeFileSync(join(repo,'source.mjs'),'owner dirty bytes');
  const prepared=preparePristineSource(repo,original,join(dir,'private'));
  assert.equal(command('git',['rev-parse','HEAD'],prepared.sourceRoot,{capture:true}),original);
  assert.equal(command('git',['status','--porcelain'],prepared.sourceRoot,{capture:true}),'');
  assert.equal(command('git',['remote'],prepared.sourceRoot,{capture:true}),'');
  assert.equal(readFileSync(join(prepared.sourceRoot,'.env.local')).length,0);
  command('git',['update-ref','refs/heads/private-test',original],prepared.sourceRoot,{capture:true});
  assert.equal(command('git',['for-each-ref','--format=%(refname)','refs/heads/private-test'],repo,{capture:true}),'');
  assert.equal(readFileSync(join(repo,'source.mjs'),'utf8'),'owner dirty bytes');
  assert.equal(command('git',['rev-parse','HEAD'],repo,{capture:true}),original);
});
for(const variant of ['remote','alternates','common-dir','index','hook','config','environment-content','environment-symlink','metadata-symlink'])test(`private archive refuses ${variant} tampering`,()=>{
  const {dir,repo}=sourceFixture(),prepared=preparePristineSource(repo,'HEAD',join(dir,'private'));
  const source=prepared.sourceRoot,git=join(source,'.git');
  if(variant==='remote')command('git',['remote','add','origin',repo],source,{capture:true});
  if(variant==='alternates')writeFileSync(join(git,'objects/info/alternates'),join(repo,'.git/objects'));
  if(variant==='common-dir')writeFileSync(join(git,'commondir'),join(repo,'.git'));
  if(variant==='index')command('git',['update-index','--force-remove','source.mjs'],source,{capture:true});
  if(variant==='hook')writeFileSync(join(git,'disabled-hooks/post-checkout'),'unexpected hook');
  if(variant==='config')command('git',['config','--local','include.path',join(repo,'.git/config')],source,{capture:true});
  if(variant==='environment-content')writeFileSync(join(source,'.env.local'),'not-empty');
  if(variant==='environment-symlink'){
    if(process.platform==='win32')return;
    renameSync(join(source,'.env.local'),join(dir,'kept-empty-env'));symlinkSync(join(dir,'kept-empty-env'),join(source,'.env.local'));
  }
  if(variant==='metadata-symlink'){
    if(process.platform==='win32')return;
    renameSync(git,join(dir,'kept-metadata'));symlinkSync(join(repo,'.git'),git);
  }
  assert.throws(()=>verifySourceTree(repo,prepared.proof.sourceCommit,source));
  assert.equal(command('git',['rev-parse','HEAD'],repo,{capture:true}),prepared.proof.sourceCommit);
});
