// Test-only RPC evaluator. Native unit tests use the existing Node/tsx test
// tools to execute the authoritative policy, never a copied Swift/C# rule.
// Application targets do not import or launch this file.
import readline from 'node:readline';
import {createMirrorPolicyHost} from '../src/local-vault/mirror-policy-host.ts';
const contexts=new Map();
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{
 try {
  if(line.length>32768)throw Error("Fixture request too large");
  const request=JSON.parse(line);
  if(!request||Object.keys(request).length!==2)throw Error("Invalid fixture request");
  const {context,script}=request;
  if(typeof context!=='string'||!/^[a-f0-9-]{32,36}$/i.test(context)||typeof script!=='string'||script.length>16384)throw Error('Invalid fixture request');
  const match=/^window\.texttextMirrorPolicy\.(handshake|bind|evaluate|schedule|lifecycle)\((.*)\)$/.exec(script);
  if(!match)throw Error('Unknown fixture operation');
  let host=contexts.get(context);
  if(!host){if(contexts.size>=4096)throw Error("Fixture context limit exceeded");host=createMirrorPolicyHost('f'.repeat(64),context);contexts.set(context,host);}
  const result=host[match[1]](...(match[2]?[JSON.parse(match[2])]:[]));
  process.stdout.write(JSON.stringify({ok:true,result:JSON.stringify(result)})+'\n');
 } catch { process.stdout.write(JSON.stringify({ok:false,error:'Native policy test RPC failed'})+'\n'); }
});
lines.on('close',()=>process.exit(0));
