// Local real-keyboard driver fixture, never six-client or product acceptance.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { typeInputSequence, checkInputProgress } from './input-sequence.mjs';
const browser = await chromium.launch({channel:'chrome', headless:true, timeout:15000});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.setContent('<div aria-label="Document body" contenteditable="true">Existing fixture text.</div>');
  await page.evaluate(() => {
    const editor = document.querySelector('[contenteditable]');
    window.fixtureEditor = editor; window.events = [];
    for (const type of ['beforeinput','input']) editor.addEventListener(type, event => window.events.push({type,eventType:event.inputType,data:event.data,trusted:event.isTrusted}));
    editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  const chunks = ['⟦mac-web:1:1:café🧑‍💻⟧', '⟦mac-web:1:2:東京🌿⟧', '[mac-web r1 alpha123]'];
  const edit = {id:'r1-mac-web',op:'append',text:chunks.join(''),inputSequence:{chunks,intervalMs:25}};
  const progress = {editId:edit.id,chunks:[],acceptedPrefix:''};
  await typeInputSequence(edit, {
    insert: async text => { assert.equal(await page.evaluate(() => window.fixtureEditor.isConnected), true); await page.keyboard.insertText(text); },
    visible: async text => (await page.locator('[contenteditable]').textContent()).split(text).length === 2,
    now: () => performance.now(), sleep: ms => page.waitForTimeout(ms), progress,
  });
  assert.ok(checkInputProgress(edit,progress));
  assert.equal(await page.locator('[contenteditable]').textContent(), 'Existing fixture text.' + chunks.join(''));
  const events = await page.evaluate(() => window.events);
  assert.deepEqual(events.filter(event => event.type === 'input').map(event => event.data), chunks);
  assert.ok(events.every(event => event.trusted && event.eventType === 'insertText'));
  // A declared observation fault: the real input happens, but no visible
  // confirmation is returned. The helper must stop at its deadline and retain
  // the uncertain attempted chunk, without claiming it accepted.
  const failedProgress = {editId:edit.id,chunks:[],acceptedPrefix:''};
  let attemptedInputs = 0;
  const failedStart = performance.now();
  await assert.rejects(typeInputSequence(edit, {
    insert: async text => { attemptedInputs++; await page.keyboard.insertText(text); },
    visible: async () => false,
    now: () => performance.now(), sleep: ms => page.waitForTimeout(ms), progress: failedProgress,
  }), /deadline/);
  const failedElapsedMs = performance.now() - failedStart;
  assert.equal(attemptedInputs, 1);
  assert.equal(failedProgress.chunks.length, 0);
  assert.ok(checkInputProgress(edit,failedProgress,false));
  assert.ok(failedElapsedMs >= 15000 && failedElapsedMs < 17000);
  console.log(JSON.stringify({kind:'browser-driver-fixture',acceptance:'none',browserVersion:browser.version(),chunks:chunks.length,unicodeScalars:chunks.map(chunk=>[...chunk].length),inputEvents:events.length,progress,visibilityFault:{attemptedInputs,confirmedChunks:failedProgress.chunks.length,elapsedMs:failedElapsedMs,attemptedChunk:failedProgress.attemptedChunk},passed:true}));
} finally { await browser.close(); }
