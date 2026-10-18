import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMultiFieldAccounting, documentObservation } from './multi-field.mjs';
const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];
const baseline={schemaVersion:1,content:{title:'Stable navigation title',subtitle:'Existing subtitle 👩‍💻',body:'Existing body 日本語',fields:{status:'draft'},tags:['preserved'],assets:[]},presentation:{template:{id:'texttext.article',version:1},theme:{accent:'#0071E3'}}};
function fixture(){
 const edits=roles.map((role,index)=>({id:`r1-${role}`,role,op:'append',field:index%2?'subtitle':'body',text:`[${role} field marker]`}));
 const snapshot=structuredClone(baseline);for(const edit of edits)snapshot.content[edit.field]+=edit.text;
 return {edits,observations:new Map(roles.map(role=>[role,structuredClone(snapshot)]))};
}
test('field accounting binds all six complete snapshots and preserves nonedited document semantics',()=>{
 const f=fixture();assert.equal(checkMultiFieldAccounting(baseline,f.observations,f.edits),documentObservation(f.observations.get('mac-app')).hash);
});
test('field accounting rejects wrong field, duplicate operation, baseline loss and hidden metadata changes',()=>{
 for(const mutate of [f=>f.edits[0].role='pc-web',f=>{const s=f.observations.get('pc-cli');s.content.subtitle+=f.edits[0].text;},f=>f.edits.push(f.edits[0]),f=>f.observations.get('mac-web').content.body=f.edits[0].text,f=>f.observations.get('pc-app').content.tags=[],f=>f.observations.get('mac-cli').content.title='renamed',f=>f.observations.delete('mac-cli')]){
  const f=fixture();mutate(f);assert.throws(()=>checkMultiFieldAccounting(baseline,f.observations,f.edits));
 }
});
test('allowed CRDT ordering must still agree across all six full snapshots',()=>{
 const f=fixture(),reordered=structuredClone(baseline);
 for(const edit of f.edits.toReversed())reordered.content[edit.field]+=edit.text;
 for(const role of roles)f.observations.set(role,structuredClone(reordered));
 assert.doesNotThrow(()=>checkMultiFieldAccounting(baseline,f.observations,f.edits));
 f.observations.get('mac-app').content.subtitle=f.observations.get('mac-app').content.subtitle.replace(f.edits[1].text,'');
 assert.throws(()=>checkMultiFieldAccounting(baseline,f.observations,f.edits),/marker/);
});
test('missing subtitle or wrong template cannot masquerade as the real multi-field fixture',()=>{
 assert.throws(()=>documentObservation({...baseline,content:{...baseline.content,subtitle:undefined}}),/visible/);
 assert.throws(()=>documentObservation({...baseline,presentation:{template:{id:'texttext.note'}}}),/article/);
});
