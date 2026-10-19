// Test-only controlled page using the genuine full-schema live inspection API.
// No editor, network transport, writer, account, or product registration.
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const output=process.argv[2];
if (!output || !isAbsolute(output) || process.argv.length!==3) throw Error('One new absolute private fixture directory required');
await mkdir(output,{mode:0o700}); // create-only; never reuse or overwrite a fixture
const result=await build({absWorkingDir:root,bundle:true,write:false,metafile:true,format:'iife',platform:'browser',target:'es2022',tsconfig:resolve(root,'tsconfig.json'),
  stdin:{resolveDir:root,sourcefile:'native-asset-inspection-fixture.ts',contents:`
import {registerLiveDocumentInspector} from './src/lib/documents/live-inspection';
import {emptyDocumentSnapshot} from './src/lib/documents/model';
const item='e1111111-1111-4111-8111-111111111111';
let document=emptyDocumentSnapshot();
document.content.title='Title';document.content.body='Body';
registerLiveDocumentInspector(item,()=>document);
Object.defineProperty(window,'assetInspectionFixture',{value:Object.freeze({
  item, reset(){document=emptyDocumentSnapshot();document.content.title='Title';document.content.body='Body';},
  setRaw(value){document=JSON.parse(JSON.stringify(value));},
  raw(){return JSON.parse(JSON.stringify(document));}
})});
window.assetInspectionFixtureReady=true;
`}});
const bytes=result.outputFiles[0].contents;
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const sources:Record<string,string>={};
for(const input of Object.keys(result.metafile!.inputs).sort()) {
  if(input==='native-asset-inspection-fixture.ts') continue;
  const path=resolve(root,input); if(!relative(root,path).startsWith('..')) sources[input]=sha(await readFile(path));
}
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Controlled native asset schema fixture</title><section aria-label="Edit item" data-ai-item-id="e1111111-1111-4111-8111-111111111111"><textarea aria-label="Subtitle"></textarea><div aria-label="Document body">Body</div></section><script>'+Buffer.from(bytes).toString().replaceAll('</script','<\\/script')+'</script>');
await writeFile(resolve(output,'inspection.html'),html,{flag:'wx',mode:0o600});
await writeFile(resolve(output,'manifest.json'),JSON.stringify({version:1,testOnly:true,htmlSha256:sha(html),sources},null,2)+'\n',{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify({directory:output,htmlSha256:sha(html),sourceCount:Object.keys(sources).length})+'\n');
