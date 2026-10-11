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
  return { text: (fault === 'different-baseline' ? 'Different fixture text.\n' : baseline) + (fault === 'lie-content' ? '' : edits.map((e) => e.text).join('')), editIds: edits.map((e) => e.id) };
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
    case 'edit':
      // drop-edit: nobody sees the edit (edit ID mismatch). private-edit: only this role sees it (hash divergence).
      if (fault === 'private-edit') { privateEdits.push(m.edit); }
      else if (fault !== 'drop-edit') { if (online) publish(m.edit); else pendingEdits.push(m.edit); }
      return out({ type: 'applied', round: m.round, editId: m.edit.id });
    case 'transport':
      online = m.online;
      if (online) while (pendingEdits.length) publish(pendingEdits.shift());
      return out({ type: 'transport', round: m.round, online: m.online });
    case 'restart': {
      if (fault === 'restart-fail') return out({ type: 'error', round: m.round, message: 'injected native restart failure' });
      generation += 1;
      sessionId = `editor-${process.pid}-${generation}`;
      reloads = 0;
      return out({ type: 'restart', round: m.round, generation });
    }
    case 'perturb':
      return out({ type: 'perturb', round: m.round, repaired: true });
    case 'observe': {
      observations++;
      if (fault === 'reload' && m.round > 1) reloads += 1;
      // Make the shared directory's content "arrive" in two steps so concurrent writers are observed after a short settle.
      setTimeout(() => {
        const state = document();
        if (fault === 'late-observe' && m.round === 1 && observations === 2) state.text += ' transient';
        out({ type: 'state', round: m.round, ...state, editor: role.endsWith('-cli') ? undefined : { sessionId, reloads } });
      }, 20);
      return;
    }
    case 'shutdown':
      process.exit(fault === 'shutdown-fail' ? 1 : 0);
  }
});
