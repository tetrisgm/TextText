// Staged real-input protocol: callbacks must focus real existing editor fields.
// No scenario flag is exposed before complete actor snapshot observation exists.
import { validateMultiFieldEdit } from './multi-field.mjs';
import { preservesSubsequence } from './undo-redo.mjs';
export function validateFieldSequence(edits,role) {
  return Array.isArray(edits) && edits.length===2 && edits.every(edit=>validateMultiFieldEdit(edit)&&edit.role===role)
    && edits[0].field==='body' && edits[1].field==='subtitle'
    && edits[0].id.replace(/-body$/,'')===edits[1].id.replace(/-subtitle$/,'')
    && edits[0].id.endsWith('-body') && edits[1].id.endsWith('-subtitle') && edits[0].text!==edits[1].text;
}
export function checkFieldProgress(edits,role,progress,complete=true) {
  if(!validateFieldSequence(edits,role)||!progress||progress.role!==role||!Array.isArray(progress.fields)
    ||progress.fields.length>2||(complete&&progress.fields.length!==2))return false;
  let previous=-1;
  for(const [index,field] of progress.fields.entries()) {
    const edit=edits[index];
    if(field.ordinal!==index+1||field.editId!==edit.id||field.field!==edit.field||field.text!==edit.text
      ||field.visible!==true||field.preservedVisibleContent!==true||!Number.isFinite(field.elapsedMs)
      ||field.elapsedMs<=previous||field.elapsedMs>15000)return false;
    previous=field.elapsedMs;
  }
  return progress.attemptedField===undefined||(!complete&&progress.attemptedField===edits[progress.fields.length]?.id);
}
export async function typeFieldSequence(edits,role,{insert,snapshot,now,sleep,progress}) {
  if(!validateFieldSequence(edits,role))throw new Error('Invalid bounded field sequence');
  const start=now();let preserved=await snapshot();
  if(!preserved||['body','subtitle'].some(field=>typeof preserved[field]!=='string'))throw new Error('Existing visible field baseline required');
  if(edits.some(edit=>preserved[edit.field].includes(edit.text)))throw new Error('Field marker already present');
  for(const [index,edit] of edits.entries()) {
    if(index>0)await sleep(1);
    progress.attemptedField=edit.id;
    await insert(edit.field,edit.text);
    for(;;) {
      const elapsedMs=now()-start;if(elapsedMs>15000)throw new Error('Field visibility or preservation deadline exceeded');
      const current=await snapshot();
      const stripped=current&&{body:current.body,subtitle:current.subtitle};
      if(stripped&&['body','subtitle'].every(field=>typeof stripped[field]==='string')&&stripped[edit.field].split(edit.text).length===2) {
        stripped[edit.field]=stripped[edit.field].replace(edit.text,'');
        if(['body','subtitle'].every(field=>preservesSubsequence(stripped[field],preserved[field]))) {
          progress.fields.push({ordinal:index+1,editId:edit.id,field:edit.field,text:edit.text,visible:true,preservedVisibleContent:true,elapsedMs});
          delete progress.attemptedField;preserved=current;break;
        }
      }
      await sleep(25);
    }
  }
}
