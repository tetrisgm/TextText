import { afterEach, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildTextpack } from '@/lib/github/textpack';
import { emptyDocumentSnapshot } from '@/lib/documents/model';
import { readVaultTextpack, writeVaultTextpack } from './store';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'texttext-portable-create-'));roots.push(root);return root;}
function input(root:string,itemId:string,relativePath:string,operationId=itemId){const document=emptyDocumentSnapshot();document.content.body='Preserved fixture';return {root,workspaceId:'workspace',itemId,relativePath,operationId,baseRevision:null,bytes:buildTextpack('Document',{document,markdown:`---\ntextTextId: ${itemId}\n---\n\nPreserved fixture`})};}

test('new pack refuses a case alias before creating any child or publishing a receipt',async()=>{
 const root=await fixture(),seed=input(root,'seed','Notes/Existing.textpack');await writeVaultTextpack(seed);
 const before=(await readVaultTextpack(seed))!.bytes;
 await expect(writeVaultTextpack(input(root,'new-item','notes/New child/New.textpack'))).rejects.toThrow(/portable folder spelling/i);
 expect(await fs.readFile(path.join(root,'workspace','Notes','Existing.textpack'))).toEqual(before);
 expect(await fs.readdir(path.join(root,'workspace','Notes'))).toEqual(['Existing.textpack']);
 await expect(fs.stat(path.join(root,'workspace','.texttext','receipts','new-item.json'))).rejects.toMatchObject({code:'ENOENT'});
});
test('nested alias refuses and exact spelling remains writable and replayable',async()=>{
 const root=await fixture();await writeVaultTextpack(input(root,'seed','Projects/Notes/Existing.textpack'));
 await expect(writeVaultTextpack(input(root,'bad','Projects/notes/New.textpack'))).rejects.toThrow(/portable folder spelling/i);
 const good=input(root,'good','Projects/Notes/New.textpack');const first=await writeVaultTextpack(good);expect(await writeVaultTextpack(good)).toEqual(first);
 expect((await readVaultTextpack(good))?.relativePath).toBe(good.relativePath);
});
test('template-selected creation folder is checked again before directory mutation',async()=>{
 const root=await fixture();await writeVaultTextpack(input(root,'seed','gallery/Existing.textpack'));
 await expect(writeVaultTextpack({...input(root,'template-new','Safe/New.textpack'),templateCreation:{id:'texttext.gallery',folderDefault:true,titleDefault:false,bodyDefault:false,fieldsDefault:false},beforeTemplateRead:async()=>{}})).rejects.toThrow(/portable folder spelling/i);
 expect(await fs.readdir(path.join(root,'workspace','gallery'))).toEqual(['Existing.textpack']);
});

test('completed creation replay keeps its identity even if a later alias exists',async()=>{
 const root=await fixture(),good=input(root,'replayed','Notes/Original.textpack');
 const saved=await writeVaultTextpack(good);
 // A case-sensitive volume can hold both; replay must not create or repair paths.
 try{await fs.mkdir(path.join(root,'workspace','notes'));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 expect(await writeVaultTextpack(good)).toEqual(saved);
});

test('canonical-equivalent parent spelling refuses before creating a second subtree',async()=>{
 const root=await fixture();const decomposed='Cafe\u0301',composed='Caf\u00e9';
 await writeVaultTextpack(input(root,'nfc-seed',`${decomposed}/Existing.textpack`));
 await expect(writeVaultTextpack(input(root,'nfc-new',`${composed}/Child/New.textpack`))).rejects.toThrow(/portable folder spelling/i);
 expect(await fs.readdir(path.join(root,'workspace',decomposed))).toEqual(['Existing.textpack']);
});

async function treeBytes(root:string):Promise<Record<string,string>> {
 const result:Record<string,string>={};
 async function visit(folder:string){for(const name of (await fs.readdir(folder)).sort()){const target=path.join(folder,name),info=await fs.lstat(target),key=path.relative(root,target);result[key]=info.isDirectory()?'directory':(await fs.readFile(target)).toString('base64');if(info.isDirectory())await visit(target);}}
 await visit(root);return result;
}
test.each(['Feeds ','Feeds.','CON','aux.txt','Notes/LPT1','Notes/Bad /Child'])('new creation rejects nonportable parent %s without filesystem or audit mutation',async folder=>{
 const root=await fixture();await writeVaultTextpack(input(root,'seed','Notes/Existing.textpack'));const before=await treeBytes(root);let audits=0;
 await expect(writeVaultTextpack({...input(root,'invalid',folder+'/New.textpack'),audit:{actorUserId:'actor',actorType:'external_agent'},onReceipt:async()=>{audits++;}})).rejects.toThrow(/portable folder/);
 expect(audits).toBe(0);expect(await treeBytes(root)).toEqual(before);
});
test('template creation refuses an invalid requested parent without mutating the tree',async()=>{
 const root=await fixture();await writeVaultTextpack(input(root,'seed','Notes/Existing.textpack'));const before=await treeBytes(root);
 await expect(writeVaultTextpack({...input(root,'invalid-template','Feeds /New.textpack'),templateCreation:{id:'texttext.gallery',folderDefault:true,titleDefault:false,bodyDefault:false,fieldsDefault:false},beforeTemplateRead:async()=>{}})).rejects.toThrow(/portable folder/);
 expect(await treeBytes(root)).toEqual(before);
});
