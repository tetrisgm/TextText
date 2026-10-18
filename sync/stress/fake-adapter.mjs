// Simulated adapter for tests and dry runs. Always attests mode "simulated"; it never claims real acceptance.
// Six processes share one directory of edit files as a stand-in for the sync server.
// Faults (STRESS_FAKE_FAULT): fail-round:<n> | drop-edit | hang | stale-ready | dup-ready | reload | restart-fail | wrong-fixture | claim-real
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sharedRoot = process.env.STRESS_FAKE_SHARED;
if (!sharedRoot) { process.stderr.write('STRESS_FAKE_SHARED is required\n'); process.exit(2); }
let shared = sharedRoot; // scoped per run on hello so repeated runs start empty
const fault = process.env.STRESS_FAKE_FAULT ?? '';
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
let role = 'unknown';
let generation = 1;
let sessionId = `editor-${process.pid}-${generation}`;
let reloads = 0;
const privateEdits = [];
const pendingEdits = [];
let observations = 0;
let online = true;

const publish = (edit) => writeFileSync(join(shared, `${edit.id}.json`), JSON.stringify(edit));

const document = () => {
  const files = readdirSync(shared).filter((f) => f.endsWith('.json')).sort();
  const edits = [...files.map((f) => JSON.parse(readFileSync(join(shared, f), 'utf8'))), ...privateEdits];
  const baseline = fault === 'baseline-lost' && edits.length ? '' : 'Existing fixture text.\n';
  const fieldSnapshot = { schemaVersion: 1, content: { title: 'Six-client acceptance simulated fixture', subtitle: 'Existing subtitle.' + edits.flatMap(edit => edit.fieldEdits ?? []).filter(edit => edit.field === 'subtitle').map(edit => edit.text).join(''), body: baseline + edits.map(edit => edit.text).join(''), fields: { fixture: 'simulated-only' }, tags: [], assets: [] }, presentation: { template: { id: 'texttext.article', version: 1 }, theme: {} } };
  if (fault === 'field-hidden-loss') fieldSnapshot.content.fields = {};
  if (fault === 'field-body-mismatch') fieldSnapshot.content.body += 'hidden mismatch';
  return { documentSnapshot: fieldSnapshot, text: (fault === 'different-baseline' ? 'Different fixture text.\n' : baseline) + (fault === 'lie-content' ? '' : edits.map((e) => e.text).join('')), editIds: edits.map((e) => e.id) };
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  switch (m.type) {
    case 'hello': {
      role = m.role;
      shared = join(sharedRoot, m.runId); mkdirSync(shared, { recursive: true });
      const fixture = fault === 'wrong-fixture' ? { workspaceId: 'other-workspace', itemId: m.fixture.itemId } : m.fixture;
      out({ type: 'attest', round: 0, mode: fault === 'claim-real' ? 'real' : 'simulated', adapter: 'fake-adapter', ...fixture,
        machineId: process.env.STRESS_FAKE_MACHINE ?? `fake-${role.split('-')[0]}` });
      return;
    }
    case 'prepare':
      if (fault === `fail-round:${m.round}`) return out({ type: 'error', round: m.round, message: 'injected actor failure token=abc123' });
      if (fault === 'hang') return;
      if (fault === 'stale-ready') out({ type: 'ready', round: m.round - 1 });
      if (fault === 'dup-ready') out({ type: 'ready', round: m.round });
      return out({ type: 'ready', round: m.round });
    case 'edit': {
      let writeProgress;
      if (m.edit.fileWriteSequence) {
        const sequence=m.edit.fileWriteSequence,count=fault==='write-prefix-fail'?1:sequence.chunks.length;
        writeProgress={editId:m.edit.id,mode:sequence.mode,writes:sequence.chunks.slice(0,count).map((text,index)=>({ordinal:index+1,suboperationId:m.edit.id+'-write'+(index+1),text,beforeSha256:'b'.repeat(64),afterSha256:'c'.repeat(64),readBackSha256:'c'.repeat(64),beforeFileIdentity:'d'.repeat(64),afterFileIdentity:(sequence.mode==='in-place'?'d':'e').repeat(64),assetDigest:'f'.repeat(64),fsynced:true,unchangedAssets:true,elapsedMs:index*sequence.intervalMs+1})),acceptedPrefix:sequence.chunks.slice(0,count).join('')};
        if(fault==='write-wrong-role')writeProgress.editId='r1-pc-cli';
        if(fault==='write-skipped')writeProgress.writes[1].ordinal=3;
        if(fault==='write-readback')writeProgress.writes[0].readBackSha256='a'.repeat(64);
        if(fault==='write-inode')writeProgress.writes[0].afterFileIdentity='a'.repeat(64);
        if(fault==='write-prefix-fail'){writeProgress.attemptedWrite={ordinal:2,suboperationId:m.edit.id+'-write2',text:sequence.chunks[1],phase:'writing',bytesWritten:12};publish({...m.edit,text:writeProgress.acceptedPrefix});return out({type:'error',round:m.round,message:'injected uncertain file write',writeProgress});}
      }
      let fieldProgress, fieldEditIds;
      if (m.edit.fieldEdits) {
        fieldEditIds = m.edit.fieldEdits.map(edit => edit.id);
        if (!role.endsWith('-cli')) fieldProgress = { role, fields: m.edit.fieldEdits.map((edit,index)=>({ ordinal:index+1,editId:edit.id,field:edit.field,text:edit.text,visible:true,preservedVisibleContent:true,elapsedMs:index+1 })) };
        if (fault === 'field-missing-progress') fieldProgress = undefined;
        if (fault === 'field-wrong-role') fieldProgress.fields[1].editId = 'r1-mac-cli-subtitle';
        if (fault === 'field-prefix-fail') { fieldProgress.fields=fieldProgress.fields.slice(0,1);fieldProgress.attemptedField=m.edit.fieldEdits[1].id;return out({type:'error',round:m.round,message:'injected field failure',fieldProgress}); }
      }
      let historyProgress;
      if (m.edit.undoRedo) {
        historyProgress = { editId: m.edit.id, stages: ['insert','undo','redo'].map((stage,index)=>({stage,editId:m.edit.id,text:m.edit.text,ownOccurrences:index===1?0:1,preservedVisibleContent:true,elapsedMs:450+index+1})) };
        if (fault === 'history-missing') historyProgress = undefined;
        else if (fault === 'history-wrong-role') historyProgress.stages[1].editId = 'r1-mac-cli';
        else if (fault === 'history-skip') historyProgress.stages.splice(1,1);
        else if (fault === 'history-loss') historyProgress.stages[1].preservedVisibleContent = false;
        else if (fault === 'history-prefix-fail') { historyProgress.stages=historyProgress.stages.slice(0,1);historyProgress.attemptedStage='undo';return out({type:'error',round:m.round,message:'injected history failure',historyProgress}); }
      }
      let inputProgress;
      if (m.edit.inputSequence) {
        const chunks = m.edit.inputSequence.chunks;
        const count = fault === 'input-prefix-fail' ? 2 : fault === 'input-early-final' ? chunks.length - 1 : chunks.length;
        inputProgress = { editId: m.edit.id, chunks: chunks.slice(0, count).map((text, index) => ({ ordinal: index + 1, text, visible: true, elapsedMs: index * m.edit.inputSequence.intervalMs + 1 })), acceptedPrefix: chunks.slice(0, count).join('') };
        if (fault === 'input-skip') inputProgress.chunks[1].ordinal = 3;
        if (fault === 'input-wrong-role') inputProgress.editId = 'r1-mac-cli';
        if (fault === 'input-clock') inputProgress.chunks[1].elapsedMs = 0;
        if (fault === 'input-prefix-fail') {
          publish({ ...m.edit, text: inputProgress.acceptedPrefix });
          return out({ type: 'error', round: m.round, message: 'injected partial input failure', inputProgress });
        }
      }
      // drop-edit: nobody sees the edit (edit ID mismatch). private-edit: only this role sees it (hash divergence).
      if (fault === 'private-edit') { privateEdits.push(m.edit); }
      else if (fault !== 'drop-edit') { if (online) publish(m.edit); else pendingEdits.push(m.edit); }
      return out({ type: 'applied', round: m.round, editId: m.edit.id, ...(writeProgress ? { writeProgress } : {}), ...(fieldEditIds ? { fieldEditIds, ...(fieldProgress ? { fieldProgress } : {}) } : {}), ...(historyProgress ? { historyProgress } : {}), ...(inputProgress ? { inputProgress } : {}) });
    }
    case 'transport':
      online = m.online;
      if (online) while (pendingEdits.length) publish(pendingEdits.shift());
      return out({ type: 'transport', round: m.round, online: m.online });
    case 'restart': {
      if (fault === 'restart-fail') return out({ type: 'error', round: m.round, message: 'injected native restart failure' });
      generation += 1;
      sessionId = `editor-${process.pid}-${generation}`;
      reloads = 0;
      const browserRestart = role.endsWith('-web'); const wasOffline = !online;
      if (browserRestart) { online = true; for (const edit of pendingEdits.splice(0)) publish(edit); }
      return out({ type: 'restart', round: m.round, generation, ...(browserRestart ? { crash: { pid: 345678, profileScopeHash: 'a'.repeat(64), method: fault === 'browser-graceful' ? 'close' : 'SIGKILL', exited: true }, reconnectByRestart: fault === 'browser-offline-lie' ? !wasOffline : wasOffline, online: true } : {}) });
    }
    case 'perturb':
      return out({ type: 'perturb', round: m.round, repaired: true });
    case 'observe': {
      observations++;
      if ((fault === 'reload' && m.round > 1) || (fault === 'sample-reload' && observations === 3)) reloads += 1;
      // Make the shared directory's content "arrive" in two steps so concurrent writers are observed after a short settle.
      setTimeout(() => {
        const state = document();
        if (fault === 'late-observe' && m.round === 1 && observations === 2) state.text += ' transient';
        if (fault === 'sample-drift' && observations === 3) state.text += ' transient';
        if (fault === 'sample-missing-ids' && observations === 3) state.editIds = [];
        if (fault === 'sample-duplicate-id' && observations === 3) state.editIds.push(state.editIds[0]);
        if (fault === 'sample-missing' && observations === 3) return;
        if (!m.documentSnapshot || fault === 'field-missing-document') delete state.documentSnapshot;
        out({ type: 'state', round: m.round, ...state, editor: role.endsWith('-cli') ? undefined : { sessionId, reloads } });
      }, 20);
      return;
    }
    case 'shutdown':
      process.exit(fault === 'shutdown-fail' ? 1 : 0);
  }
});
