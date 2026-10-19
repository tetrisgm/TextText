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
test('explicit undefined subtitle or wrong template cannot masquerade as a valid article',()=>{
 assert.throws(()=>documentObservation({...baseline,content:{...baseline.content,subtitle:undefined}}),/visible/);
 assert.throws(()=>documentObservation({...baseline,presentation:{template:{id:'texttext.note'}}}),/article/);
});

test('absent optional subtitle remains absent through body-only full accounting',()=>{
 const initial=structuredClone(baseline);delete initial.content.subtitle;
 const edits=roles.map(role=>({id:`r1-${role}`,role,op:'append',field:'body',text:`[${role} body]`}));
 const current=structuredClone(initial);current.content.body+=edits.map(e=>e.text).join('');
 const observations=new Map(roles.map(role=>[role,structuredClone(current)]));
 assert.equal(Object.hasOwn(documentObservation(initial).snapshot.content,'subtitle'),false);
 assert.doesNotThrow(()=>checkMultiFieldAccounting(initial,observations,edits));
 observations.get('mac-app').content.subtitle='';
 assert.throws(()=>checkMultiFieldAccounting(initial,observations,edits),/Unplanned/);
});

test('planned subtitle input may create an absent field without losing hidden metadata',()=>{
 const initial=structuredClone(baseline);delete initial.content.subtitle;
 const edits=roles.map(role=>({id:`r1-${role}`,role,op:'append',field:'subtitle',text:`[${role} subtitle]`}));
 const current=structuredClone(initial);current.content.subtitle=edits.map(e=>e.text).join('');
 const observations=new Map(roles.map(role=>[role,structuredClone(current)]));
 assert.doesNotThrow(()=>checkMultiFieldAccounting(initial,observations,edits));
 observations.get('pc-app').content.fields.status='changed';
 assert.throws(()=>checkMultiFieldAccounting(initial,observations,edits),/Unplanned/);
});

test('present invalid subtitle values cannot pass optional-field inspection',()=>{
 for(const subtitle of [undefined,null,0,false,{},[]])
  assert.throws(()=>documentObservation({...baseline,content:{...baseline.content,subtitle}}));
});

test('mixed accounting requires explicit bounded expansion while default600 remains', () => {
  const edits = Array.from({
    length: 601
  }, (_, i) => ({
    role: 'mac-app',
    id: `r${i + 1}-mac-app`,
    field: 'body',
    op: 'append',
    text: `⟦mixed:${i + 1}⟧`
  }));
  const current = structuredClone(baseline);
  current.content.body += edits.map(e => e.text).join('');
  const states = new Map(roles.map(role => [role, structuredClone(current)]));
  assert.throws(() => checkMultiFieldAccounting(baseline, states, edits));
  assert.doesNotThrow(() => checkMultiFieldAccounting(baseline, states, edits, {
    maxEdits: 1200
  }));
  for (const maxEdits of [0, 601, 1201, Infinity]) assert.throws(() => checkMultiFieldAccounting(baseline, states, edits, {
    maxEdits
  }));
});
