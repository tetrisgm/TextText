import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUndoRedo, checkUndoRedoProgress, exerciseUndoRedo, preservesSubsequence } from './undo-redo.mjs';
const edit = { id:'mac-web-1',op:'append',text:'[unique-history-marker]',undoRedo:true };
function fixture({ brokenUndo=false, loseRemote=false }={}) {
  let text='base 👩‍💻 日本語', clock=0;
  const progress={editId:edit.id,stages:[]};
  return {progress, options:{progress, now:()=>clock, sleep:async ms=>{clock+=ms;}, snapshot:async()=>text,
    insert:async value=>{text+='remote'+value;},undo:async()=>{if(!brokenUndo) text=text.replace(edit.text,'');if(loseRemote) text=text.replace('remote','');},redo:async()=>{text+=edit.text;}}};
}
test('real history action hooks preserve concurrent visible content and produce exact ordered evidence',async()=>{
  const f=fixture();await exerciseUndoRedo(edit,f.options);assert.equal(checkUndoRedoProgress(edit,f.progress),true);
  assert.deepEqual(f.progress.stages.map(stage=>stage.stage),['insert','undo','redo']);
});
test('history evidence refuses another actor, missing stage, duplicate stage, wrong marker and lost preservation',async()=>{
  const f=fixture();await exerciseUndoRedo(edit,f.options);
  for(const mutate of [p=>p.editId='pc-app-1',p=>p.stages.pop(),p=>p.stages[1].stage='insert',p=>p.stages[1].editId='other',p=>p.stages[0].text='other',p=>p.stages[1].preservedVisibleContent=false,p=>p.stages[1].elapsedMs=p.stages[0].elapsedMs]){
    const p=structuredClone(f.progress);mutate(p);assert.equal(checkUndoRedoProgress(edit,p),false);
  }
});
test('undo failures stop before redo and retain completed evidence prefix',async()=>{
  for(const failure of [{brokenUndo:true},{loseRemote:true}]){
    const f=fixture(failure);await assert.rejects(exerciseUndoRedo(edit,f.options),/history|preservation/);
    assert.equal(f.progress.stages.length,1);assert.equal(checkUndoRedoProgress(edit,f.progress,false),true);
  }
});
test('protocol rejects combined sustained typing or unsupported operation and compares Unicode correctly',()=>{
  assert.equal(validateUndoRedo({...edit,inputSequence:{}}),false);
  assert.equal(validateUndoRedo({...edit,op:'replace'}),false);
  assert.equal(preservesSubsequence('remote👩‍💻x日本語','👩‍💻日本語'),true);
  assert.equal(preservesSubsequence('👩日本語','👩‍💻日本語'),false);
});
