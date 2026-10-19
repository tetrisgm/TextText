import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync,symlinkSync,readdirSync}from'node:fs';import{join,resolve,dirname}from'node:path';import{tmpdir}from'node:os';import{fileURLToPath}from'node:url';import{PassThrough}from'node:stream';import{EventEmitter}from'node:events';import{spawn,spawnSync}from'node:child_process';
import{LIMITS,lineValue,runtimeBound,preflight,safeAncestors,writeMailbox,readMailbox,lines,relay}from'./stress-browser-relay.mjs';import{pump}from'./stress-browser-child.mjs';
const temp=()=>mkdtempSync(join(realpathSync(tmpdir()),'texttext-browser-transport-'));
const here=dirname(fileURLToPath(import.meta.url)),driver=resolve(here,'../../sync/stress/browser-adapter.mjs');
function configFixture(extra={}){const root=temp(),session=join(root,'session'),receipt=join(root,'seal.json'),config=join(root,'config.json');writeFileSync(receipt,'{}');writeFileSync(config,JSON.stringify({role:'pc-web',profile:join(session,'browser-profile'),workspaceId:'be28ae03-c64e-4695-80af-04f048f86f37',itemId:'f52c9a01-8af6-469c-81ba-ca8d6cb556da',title:'Six-client acceptance controlled',auth:'saved-app',identityReceipt:receipt,...extra}));return{root,session,config,receipt};}
const fakeAdapterScript=`const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='shutdown')process.exit(0);process.stdout.write(line+'\\n')});`;
async function roundtrip(messages,script=fakeAdapterScript,inspect=async()=>{}){const session=join(temp(),'session'),input=new PassThrough(),output=new PassThrough();let observed='';output.on('data',b=>observed+=b);let pumping;const running=relay({session,input,output,inspect,start:async()=>{mkdirSync(session);pumping=pump({session,spawnAdapter:()=>spawn(process.execPath,['-e',script],{stdio:['pipe','pipe','pipe']})});},finish:async()=>{await pumping;}});await new Promise(r=>setTimeout(r,5));input.end(messages.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')+'\n');const code=await running;return{session,code,observed,files:readdirSync(session)};}
test('budgets match browser request/coordinator response UTF16 limits and finite runtime',()=>{assert.equal(LIMITS.requestChars,64*1024);assert.equal(LIMITS.replyChars,256*1024);assert.equal(runtimeBound(),420000);assert.equal(runtimeBound(7200000),7200000);for(const v of[0,999,7200001,Infinity,1.5,'bad'])assert.throws(()=>runtimeBound(v));const exact=JSON.stringify({type:'observe',text:'日本😀'.repeat(10000)});assert.ok(lineValue(exact));assert.throws(()=>lineValue(JSON.stringify({type:'x',text:'x'.repeat(65536)})));assert.throws(()=>lineValue('{}'));assert.throws(()=>lineValue('null'));});
test('bounded decoder preserves Unicode across chunk boundaries, refuses incomplete/oversize',()=>{const stream=new PassThrough(),got=[],errors=[];lines(stream,x=>got.push(x),100,e=>errors.push(e));const bytes=Buffer.from('{"type":"x","text":"日本😀"}\n');for(const b of bytes)stream.write(Buffer.from([b]));stream.end();assert.equal(got[0],bytes.toString().trimEnd());assert.equal(errors.length,0);const bad=new PassThrough();lines(bad,()=>assert.fail(),4,e=>errors.push(e));bad.write('12345');assert.equal(errors.length,1);});
test('preflight exact sealed source occurs before task/session/profile creation',()=>{const f=configFixture();let calls=0;const result=preflight(driver,f.config,f.session,{verify:(path,role,files)=>{calls++;assert.equal(path,f.receipt);assert.equal(role,'pc-web');assert.ok(files.browserChild);return{sourceCommit:'a'.repeat(40)};}});assert.equal(calls,1);assert.equal(result.driver,driver);assert.ok(!existsSync(f.session));assert.throws(()=>preflight(driver,f.config,f.session),/sealed|receipt|identity/i);assert.ok(!existsSync(f.session));assert.throws(()=>preflight(process.execPath,f.config,f.session,{verify:()=>assert.fail()}),/Exact/);});
test('preflight refuses old/shared/foreign profiles, absent seal and existing session',()=>{for(const extra of[{profile:join(temp(),'normal-profile')},{auth:'existing-profile'},{identityReceipt:undefined}]){const f=configFixture(extra);assert.throws(()=>preflight(driver,f.config,f.session,{verify:()=>({})}));assert.ok(!existsSync(f.session));}const f=configFixture();mkdirSync(f.session);assert.throws(()=>preflight(driver,f.config,f.session,{verify:()=>({})}),/fresh/);});
test('unsafe ancestor links and dangling links refuse without following',()=>{const root=temp(),link=join(root,'link');symlinkSync(join(root,'absent'),link,process.platform==='win32'?'junction':undefined);assert.throws(()=>safeAncestors(join(link,'session')),/links/);});
test('mailbox publication is create-only and strict exact-line read',()=>{const root=temp(),line=' {"type":"observe","text":"日本😀"} ';writeMailbox(root,'req',1,line);assert.equal(readMailbox(root,'req',1),line);assert.throws(()=>writeMailbox(root,'req',1,'{"type":"other"}'));assert.equal(readMailbox(root,'req',1),line);writeFileSync(join(root,'out-000001.jsonl'),'{}\n{}\n');assert.throws(()=>readMailbox(root,'out',1,true),/one exact/);});
test('controlled adapter forwards every opaque request/reply unchanged and shutdown exits',async()=>{const values=[' {"type":"hello","id":1,"document":{"subtitle":null}} ',JSON.stringify({type:'observe',text:'日本😀',unknown:{opaque:true}}),{type:'shutdown'}];const r=await roundtrip(values);assert.equal(r.code,0);assert.equal(r.observed,values.slice(0,2).join('\n')+'\n');assert.equal(JSON.parse(readFileSync(join(r.session,'child-exit.json'))).adapterExitCode,0);});
test('EOF adds one orderly shutdown, never an identity or acknowledgement',async()=>{const r=await roundtrip([{type:'hello'}]);assert.equal(r.code,0);assert.equal(r.observed,'{"type":"hello"}\n');assert.equal(JSON.parse(readFileSync(join(r.session,'req-000002.jsonl'))).type,'shutdown');assert.ok(!r.files.includes('req-000003.jsonl'));});
test('malformed input fails without forwarding it or fabricating output',async()=>{const r=await roundtrip(['bad-json']);assert.equal(r.code,1);assert.equal(r.observed,'');assert.equal(JSON.parse(readFileSync(join(r.session,'req-000001.jsonl'))).type,'shutdown');});
test('adapter error remains exact and stops queued mutations before dispatch',async()=>{const script=`const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='shutdown')process.exit(0);process.stdout.write('{"type":"error","message":"fixture refusal"}\\n')});`;const r=await roundtrip([{type:'hello'}],script);assert.equal(r.code,1);assert.equal(r.observed,'{"type":"error","message":"fixture refusal"}\n');assert.equal(JSON.parse(readFileSync(join(r.session,'child-exit.json'))).code,1);});
function stalled(){const c=new EventEmitter();c.pid=123;c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.unref=()=>{};for(const p of[c.stdin,c.stdout,c.stderr])p.unref=()=>{};return c;}
test('deadline preserves stalled owned child, no signal/kill and no fake success',async()=>{const session=temp(),c=stalled();let clock=0;c.kill=()=>assert.fail('must never signal');const result=await pump({session,spawnAdapter:()=>c,maxMs:1000,now:()=>clock+=10000});assert.equal(result.retained,true);assert.equal(result.code,1);assert.equal(result.forceTermination,false);});
test('runtime rejection preserves held actual attestation instead of publishing trusted hello',async()=>{const session=temp(),c=stalled();c.stdin.on('data',()=>{queueMicrotask(()=>c.emit('close',0,null));});setTimeout(()=>c.stdout.write('{"type":"attest","identity":{"actual":true}}\n'),5);const r=await pump({session,spawnAdapter:()=>c,inspect:async()=>{throw Error('wrong session');}});assert.equal(r.code,1);assert.equal(readFileSync(join(session,'held-output.jsonl'),'utf8'),'{"type":"attest","identity":{"actual":true}}\n');assert.ok(!existsSync(join(session,'out-000001.jsonl')));});
test('runtime attestation verification does not rewrite valid identity fields',async()=>{const session=temp(),c=stalled();let inspected=0;c.stdin.on('data',()=>queueMicrotask(()=>c.emit('close',0,null)));setTimeout(()=>{c.stdout.write('{"type":"attest","identity":{"actual":true}}\n');writeMailbox(session,'req',1,'{"type":"shutdown"}');},5);const r=await pump({session,spawnAdapter:()=>c,inspect:async()=>{inspected++;}});assert.equal(r.code,0);assert.equal(inspected,1);assert.equal(readMailbox(session,'out',1,true),'{"type":"attest","identity":{"actual":true}}');});
test('PowerShell owns exact interactive task and never force terminates',()=>{const source=readFileSync(join(here,'stress-browser-task.ps1'),'utf8');assert.match(source,/-LogonType Interactive/);assert.match(source,/SetAccessRuleProtection\(\$true,\$false\)/);assert.match(source,/GetOwner/);assert.match(source,/LastTaskResult -ne 0/);assert.match(source,/AutofillAiWalletPrivatePasses/);assert.match(source,/--headless/);assert.doesNotMatch(source,/Stop-Process|Stop-ScheduledTask|taskkill|TerminateProcess/);});
test('unsolicited additional valid output lines are all forwarded in order',async()=>{const script=`const r=require('node:readline');r.createInterface({input:process.stdin}).on('line',line=>{if(JSON.parse(line).type==='shutdown')process.exit(0);process.stdout.write('{"type":"first"}\\n{"type":"second","unknown":[1,2]}\\n')});`;const r=await roundtrip([{type:'hello'}],script);assert.equal(r.code,0);assert.equal(r.observed,'{"type":"first"}\n{"type":"second","unknown":[1,2]}\n');});
test('error followed by immediate child exit preserves actual error and failure',async()=>{const script=`process.stdin.once('data',()=>{process.stdout.write('{"type":"error","message":"refused"}\\n');process.exitCode=1;process.stdin.destroy()});`;const r=await roundtrip([{type:'hello'}],script);assert.equal(r.code,1);assert.equal(r.observed,'{"type":"error","message":"refused"}\n');});
test('startup refusal never creates output or launches a fallback',async()=>{const session=join(temp(),'session'),input=new PassThrough(),output=new PassThrough();let data='';output.on('data',b=>data+=b);await assert.rejects(relay({session,input,output,start:async()=>{throw Error('task refusal')},finish:async()=>assert.fail()}),/task refusal/);assert.equal(data,'');assert.ok(!existsSync(session));});
test('failed task/browser exit check cannot be converted into success',async()=>{const session=temp(),input=new PassThrough(),output=new PassThrough();writeFileSync(join(session,'child-exit.json'),JSON.stringify({code:0,retained:false}));await assert.rejects(relay({session,input,output,start:async()=>{},finish:async()=>{throw Error('browser still exists')}}),/browser still exists/);});
test('malformed durable request triggers orderly shutdown without forwarding it',async()=>{const session=temp(),c=stalled();let got='';c.stdin.on('data',b=>{got+=b;queueMicrotask(()=>c.emit('close',0,null));});writeFileSync(join(session,'req-000001.jsonl'),'bad\n');const r=await pump({session,spawnAdapter:()=>c});assert.equal(r.code,1);assert.equal(got,'{"type":"shutdown"}\n');});
test('stderr is bounded and secrets split across chunks are never written raw',async()=>{const session=temp(),c=stalled();c.stdin.on('data',()=>queueMicrotask(()=>c.emit('close',0,null)));setTimeout(()=>{c.stderr.write('authorization: Bear');c.stderr.write('er fixture-private-value\n');writeMailbox(session,'req',1,'{"type":"shutdown"}');},5);await pump({session,spawnAdapter:()=>c});const text=readFileSync(join(session,'adapter-stderr.log'),'utf8');assert.match(text,/authorization=\[redacted\]/);assert.doesNotMatch(text,/fixture-private-value/);});
test('malformed UTF8 is rejected without replacement, including split incomplete bytes',async()=>{
 const stream=new PassThrough(),got=[],errors=[];
 lines(stream,line=>{lineValue(line);got.push(line)},100,e=>errors.push(e));
 stream.write(Buffer.concat([Buffer.from('{"type":"x","text":"'),Buffer.from([0xc0,0xaf]),Buffer.from('"}\n')]));
 stream.end();await new Promise(r=>setImmediate(r));
 assert.equal(got.length,0);assert.equal(errors.length,1);
 const partial=new PassThrough(),bad=[];
 lines(partial,()=>assert.fail(),100,e=>bad.push(e));
 partial.end(Buffer.from([0xe3]));await new Promise(r=>setImmediate(r));
 assert.equal(bad.length,1);
 const root=temp();writeFileSync(join(root,'req-000001.jsonl'),Buffer.from([0xff,0x0a]));
 assert.throws(()=>readMailbox(root,'req',1),/encoded|encoding|data/i);
});
test('valid replacement character stays unchanged and BOM is not silently removed',async()=>{
 const valid=new PassThrough(),got=[];
 lines(valid,line=>{lineValue(line);got.push(line)},100,()=>assert.fail());
 valid.end('{"type":"x","text":"�"}\n');await new Promise(r=>setImmediate(r));
 assert.equal(got[0],'{"type":"x","text":"�"}');
 const bom=new PassThrough(),errors=[];
 lines(bom,line=>lineValue(line),100,e=>errors.push(e));
 bom.end('\ufeff{"type":"x"}\n');await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,1);
});
test('relay verifies both initial and restart generations before exact forwarding',async()=>{
 const script="require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='shutdown')process.exit(0);process.stdout.write(JSON.stringify(m.type==='hello'?{type:'attest',opaque:1}:{type:'restart',attestation:{type:'attest',opaque:2}})+'\\n')});";
 const inspected=[];const r=await roundtrip([{type:'hello'},{type:'restart'},{type:'shutdown'}],script,async value=>inspected.push(value.type));
 assert.equal(r.code,0);assert.deepEqual(inspected,['attest','restart']);
 assert.equal(r.observed,'{"type":"attest","opaque":1}\n{"type":"restart","attestation":{"type":"attest","opaque":2}}\n');
});
test('relay never publishes an actual hello rejected by runtime/security check',async()=>{
 const script="require('node:readline').createInterface({input:process.stdin}).on('line',line=>{if(JSON.parse(line).type==='shutdown')process.exit(0);process.stdout.write('{\"type\":\"attest\",\"actual\":true}\\n')});";
 const r=await roundtrip([{type:'hello'}],script,async()=>{throw Error('security refused')});
 assert.equal(r.code,1);assert.equal(r.observed,'');
 assert.equal(readMailbox(r.session,'out',1,true),'{"type":"attest","actual":true}');
});
test('PowerShell literal registry path and whitespace feature regex are exact',()=>{
 const source=readFileSync(join(here,'stress-browser-task.ps1'),'utf8');
 assert.ok(source.includes('HKLM:\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments'));
 assert.ok(source.includes('--disable-features=("[^"]*"|[^\\s]+)'));
 assert.match(source,/Audit \('generation-'/);
 assert.match(source,/child-ready\.json/);
 assert.match(source,/record\.startUtc/);
});
test('actual Windows PowerShell evaluates registry and last-feature literals',{skip:process.platform!=='win32'},()=>{
 const file=join(here,'stress-browser-task.ps1').replaceAll("'","''");
 const command=[
  "$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile('"+file+"',[ref]$t,[ref]$e);if($e.Count){throw 'Parse failed'}",
  "$s=@($a.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst]},$true))",
  "$key=@($s|Where-Object {$_.Value.StartsWith('HKLM:')});$pattern=@($s|Where-Object {$_.Value.StartsWith('--disable-features=')})",
  "if($key.Count -ne 1 -or $pattern.Count -ne 1){throw 'Literal unavailable'}",
  "$dummy='msedge --disable-features=One,Two --other=x --disable-features=One,Two,AutofillAiWalletPrivatePasses --end=y'",
  "$flags=@([regex]::Matches($dummy,$pattern[0].Value)|ForEach-Object {$_.Groups[1].Value.Trim('\"')})",
  "@{key=$key[0].Value;flags=$flags;wrongLastRejected=($flags[-1] -cne 'One,Two')}|ConvertTo-Json -Depth 3"
 ].join(';');
 const result=spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(result.status,0,result.stderr);const parsed=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
 assert.equal(parsed.key,'HKLM:\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments');
 assert.deepEqual(parsed.flags,['One,Two','One,Two,AutofillAiWalletPrivatePasses']);assert.equal(parsed.wrongLastRejected,true);
});

test('preflight refuses foreign role or browser mode before seal verification or task creation',()=>{
 for(const extra of[{role:undefined},{role:'mac-web'},{role:'pc-cli'},{headless:true},{headless:null},{channel:'chrome'},{channel:null}]){
  const f=configFixture(extra);let calls=0;
  assert.throws(()=>preflight(driver,f.config,f.session,{verify:()=>{calls++;return{};}}),/PC web role and headed Microsoft Edge/);
  assert.equal(calls,0);assert.equal(existsSync(f.session),false);
 }
 const f=configFixture({headless:false,channel:'msedge'});
 assert.doesNotThrow(()=>preflight(driver,f.config,f.session,{verify:()=>({})}));
});
