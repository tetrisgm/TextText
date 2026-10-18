// Isolated real keyboard driver fixture; no app or physical acceptance claim.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { exerciseUndoRedo, checkUndoRedoProgress } from './undo-redo.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true,timeout:15000});
try {
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.setContent('<div contenteditable="true">Prior marker 👩‍💻 日本語.</div>');
  await page.evaluate(()=>{const e=document.querySelector('[contenteditable]');window.events=[];e.addEventListener('input',event=>window.events.push({type:event.inputType,trusted:event.isTrusted}));e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);});
  const edit={id:'driver-history-1',op:'append',text:'[new history marker]',undoRedo:true};
  const progress={editId:edit.id,stages:[]};
  await exerciseUndoRedo(edit,{progress,insert:text=>page.keyboard.insertText(text),
    undo:()=>page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z'),
    redo:()=>page.keyboard.press(process.platform==='darwin'?'Meta+Shift+z':'Control+y'),
    snapshot:()=>page.locator('[contenteditable]').textContent(),now:()=>performance.now(),sleep:ms=>page.waitForTimeout(ms)});
  assert.ok(checkUndoRedoProgress(edit,progress));
  const events=await page.evaluate(()=>window.events);
  assert.deepEqual(events.map(e=>e.type),['insertText','historyUndo','historyRedo']);assert.ok(events.every(e=>e.trusted));
  console.log(JSON.stringify({kind:'browser-driver-fixture',acceptance:'none',browserVersion:browser.version(),progress,events,passed:true}));
} finally {await browser.close();}
