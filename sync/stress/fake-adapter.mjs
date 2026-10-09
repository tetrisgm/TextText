// Simulated adapter for tests and dry runs. Always attests mode "simulated"; it never claims real acceptance.
// Six processes share one directory of edit files as a stand-in for the sync server.
// Faults (STRESS_FAKE_FAULT): fail-round:<n> | drop-edit | hang | stale-ready | dup-ready | reload | wrong-fixture | claim-real
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sharedRoot = process.env.STRESS_FAKE_SHARED;
if (!sharedRoot) { process.stderr.write('STRESS_FAKE_SHARED is required\n'); process.exit(2); }
let shared = sharedRoot; // scoped per run on hello so repeated runs start empty
const fault = process.env.STRESS_FAKE_FAULT ?? '';
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
let role = 'unknown';
const sessionId = `editor-${process.pid}`;
let reloads = 0;
const privateEdits = [];

const document = () => {
  const files = readdirSync(shared).filter((f) => f.endsWith('.json')).sort();
  const edits = [...files.map((f) => JSON.parse(readFileSync(join(shared, f), 'utf8'))), ...privateEdits];
  const baseline = fault === 'baseline-lost' && edits.length ? '' : 'Existing fixture text.\n';
  return { text: baseline + (fault === 'lie-content' ? '' : edits.map((e) => e.text).join('')), editIds: edits.map((e) => e.id) };
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
      if (fault === 'private-edit') { privateEdits.push(m.edit); } else if (fault !== 'drop-edit') writeFileSync(join(shared, `${m.edit.id}.json`), JSON.stringify(m.edit));
      return out({ type: 'applied', round: m.round, editId: m.edit.id });
    case 'observe': {
      if (fault === 'reload' && m.round > 1) reloads += 1;
      // Make the shared directory's content "arrive" in two steps so concurrent writers are observed after a short settle.
      setTimeout(() => out({ type: 'state', round: m.round, ...document(), editor: role.endsWith('-cli') ? undefined : { sessionId, reloads } }), 20);
      return;
    }
    case 'shutdown':
      process.exit(0);
  }
});
