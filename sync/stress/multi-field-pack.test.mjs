import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync,strToU8,strFromU8 } from 'fflate';
import { readPack,markdownOf } from './file-adapter.mjs';
import { appendFieldToPack } from './multi-field-pack.mjs';
const config={itemId:'item-1',title:'Six-client acceptance field fixture'};
function fixture(header='excerpt: "Existing subtitle 👩‍💻"') {
 return zipSync({'text.md':strToU8(`---\ntextTextId: item-1\ntitle: "${config.title}"\n${header}\n---\n\nExisting body.`),
 'document.json':strToU8(JSON.stringify({schemaVersion:1,content:{title:config.title,subtitle:'Existing subtitle 👩‍💻',body:'Existing body.'},presentation:{template:{id:'texttext.article',version:1}}})),
 'assets/preserve.bin':new Uint8Array([0,255,7]),'projection.json':strToU8('{"prior":"baseline"}')});
}
test('ordinary external subtitle write changes only canonical text projection and preserves exact other entries',()=>{
 const before=readPack(fixture()),after=readPack(appendFieldToPack(fixture(),config,'subtitle','[field marker]'));
 assert.match(markdownOf(after),/excerpt: "Existing subtitle 👩‍💻\[field marker\]"/);
 assert.ok(markdownOf(after).endsWith('Existing body.'));
 for(const entry of before.entries)if(entry.name!=='text.md')assert.deepEqual(after.entries.find(e=>e.name===entry.name).data,entry.data);
 assert.equal(strFromU8(after.entries.find(e=>e.name==='document.json').data),strFromU8(before.entries.find(e=>e.name==='document.json').data));
});
test('field projection writer refuses duplicate missing malformed subtitle metadata and unsupported fields',()=>{
 for(const header of ['excerpt: "a"\nexcerpt: "b"','other: "a"','excerpt: not-json'])assert.throws(()=>appendFieldToPack(fixture(header),config,'subtitle','[marker]'));
 assert.throws(()=>appendFieldToPack(fixture(),config,'title','rename'));
});

test('guarded ordinary file write publishes both field intents in one replacement and retains original backup',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,readdirSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {applyEdit}=await import('./file-adapter.mjs');
 const dir=mkdtempSync(join(tmpdir(),'texttext-field-write-')),file=join(dir,'fixture.textpack'),bytes=fixture();writeFileSync(file,bytes);
 const fields=['body','subtitle'].map(field=>({id:`r1-mac-cli-${field}`,role:'mac-cli',field,op:'append',text:`[${field} external marker]`}));
 const result=await applyEdit({file,config:{...config,role:'mac-cli'},text:fields[0].text,fieldEdits:fields,round:1,runDir:dir});
 assert.equal(result.attempt,1);const final=markdownOf(readPack(readFileSync(file)));assert.ok(final.includes(fields[0].text));assert.ok(final.includes(fields[1].text));
 const backup=readdirSync(dir).find(name=>name.endsWith('-before.textpack'));assert.deepEqual(readFileSync(join(dir,backup)),Buffer.from(bytes));
});
