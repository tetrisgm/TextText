import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInputSequence, checkInputProgress, typeInputSequence } from './input-sequence.mjs';
import { planRounds } from './coordinator.mjs';
const edit = () => planRounds(42, 1, 'append', { chunks: 4, intervalMs: 25 })[0].edits[0];

test('sequence uses scalar bounded unique Unicode chunks and one final marker', () => {
  const value = edit();
  assert.ok(validateInputSequence(value));
  assert.equal(value.inputSequence.chunks.join(''), value.text);
  for (const change of [s => { s.chunks[1] = s.chunks[0]; }, s => { s.intervalMs = 0; }, s => { s.chunks = ['x']; }, s => { s.chunks[0] = 'x'.repeat(51); }]) {
    const changed = structuredClone(value); change(changed.inputSequence);
    assert.equal(validateInputSequence(changed), false);
  }
  assert.equal(validateInputSequence({ ...value, op: 'replace-selection' }), false);
});

test('real input helper calls input once per chunk, checks visible text and records monotonic progress', async () => {
  const value = edit(); let clock = 0; const inputs = [];
  const progress = { editId: value.id, chunks: [], acceptedPrefix: '' };
  await typeInputSequence(value, { insert: async text => { inputs.push(text); clock++; }, visible: async text => inputs.includes(text), now: () => clock, sleep: async ms => { clock += ms; }, progress });
  assert.deepEqual(inputs, value.inputSequence.chunks);
  assert.ok(checkInputProgress(value, progress));
  for (const change of [p => { p.editId = 'r1-pc-app'; }, p => { p.chunks[1].ordinal = 3; }, p => { p.chunks[1].elapsedMs = 0; }, p => { p.chunks[1].elapsedMs = p.chunks[0].elapsedMs + 1; }, p => { p.chunks.pop(); }, p => { p.acceptedPrefix = 'wrong'; }]) {
    const changed = structuredClone(progress); change(changed);
    assert.equal(checkInputProgress(value, changed), false);
  }
});

test('partial input failure retains confirmed prefix and uncertain attempted chunk without further input', async () => {
  const value = edit(); let clock = 0; const inputs = [];
  const progress = { editId: value.id, chunks: [], acceptedPrefix: '' };
  await assert.rejects(typeInputSequence(value, { insert: async text => { inputs.push(text); if (inputs.length === 3) throw new Error('input failed'); clock++; }, visible: async () => true, now: () => clock, sleep: async ms => { clock += ms; }, progress }), /input failed/);
  assert.equal(inputs.length, 3);
  assert.equal(progress.chunks.length, 2);
  assert.equal(progress.acceptedPrefix, value.inputSequence.chunks.slice(0, 2).join(''));
  assert.deepEqual(progress.attemptedChunk, { ordinal: 3, text: value.inputSequence.chunks[2] });
  assert.ok(checkInputProgress(value, progress, false));
  assert.equal(checkInputProgress(value, progress), false);
});

test('visibility timeout stops a sequence and retains the attempted chunk', async () => {
  const value = edit(); let clock = 0; let inputs = 0;
  const progress = { editId: value.id, chunks: [], acceptedPrefix: '' };
  await assert.rejects(typeInputSequence(value, { insert: async () => { inputs++; }, visible: async () => false, now: () => clock, sleep: async ms => { clock += ms; }, progress }), /deadline/);
  assert.equal(inputs, 1);
  assert.equal(progress.chunks.length, 0);
  assert.ok(checkInputProgress(value, progress, false));
});

test('streamed progress is detached exact prefix and callback failure stops further input',async()=>{const value=edit();let clock=0,inputs=0;const progress={editId:value.id,chunks:[],acceptedPrefix:''},seen=[];await assert.rejects(typeInputSequence(value,{insert:async()=>{inputs++;clock++;},visible:async()=>true,now:()=>clock,sleep:async ms=>{clock+=ms;},progress,onProgress:p=>{seen.push(p);if(seen.length===2)throw new Error('delivery failed');p.chunks[0].text='detached mutation';}}),/delivery failed/);assert.equal(inputs,2);assert.ok(checkInputProgress(value,progress,false));assert.equal(progress.chunks.length,2);assert.equal(seen[0].chunks.length,1);});
