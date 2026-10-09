// Bounded six-client stress coordinator. Finite seeded rounds, all-ready barrier, concurrent dispatch,
// exact convergence, first-failure stop with preserved evidence. No background service.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessAdapter, redact } from './adapter.mjs';

export const ROLES = ['mac-app', 'mac-web', 'mac-cli', 'pc-app', 'pc-web', 'pc-cli'];
export const EDITOR_ROLES = ROLES.filter((r) => !r.endsWith('-cli'));
const MODES = new Set(['real', 'simulated']);
const MAX_TEXT = 64 * 1024;
const WORDS = ['alpha', 'bravo', 'delta', 'echo', 'kilo', 'lima', 'oscar', 'tango', 'yankee', 'zulu'];

export const machineOf = (role) => role.split('-')[0];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const normalizeText = (text) =>
  String(text).replace(/\r\n/g, '\n');
export const hashText = (text) => createHash('sha256').update(normalizeText(text)).digest('hex');

// Deterministic per-round edit plan from the seed.
export function planRounds(seed, rounds) {
  const rand = mulberry32(seed);
  const plan = [];
  for (let round = 1; round <= rounds; round += 1) {
    const edits = ROLES.map((role) => {
      const word = WORDS[Math.floor(rand() * WORDS.length)];
      const n = Math.floor(rand() * 1000);
      return { role, id: `r${round}-${role}`, op: 'append', text: `[${role} r${round} ${word}${n}]` };
    });
    plan.push({ round, edits });
  }
  return plan;
}

export function validateConfig(config) {
  const fail = (m) => { throw new Error(`config: ${m}`); };
  if (!config || typeof config !== 'object') fail('must be an object');
  if (!MODES.has(config.mode)) fail('mode must be "real" or "simulated"');
  if (!Number.isInteger(config.seed)) fail('seed must be an integer');
  if (!Number.isInteger(config.rounds) || config.rounds < 1 || config.rounds > 10_000) fail('rounds must be 1..10000');
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 120000) fail('timeoutMs must be 100..120000');
  const f = config.fixture;
  if (!f || typeof f.workspaceId !== 'string' || !f.workspaceId || typeof f.itemId !== 'string' || !f.itemId) fail('fixture.workspaceId and fixture.itemId are required');
  if (!config.roles || typeof config.roles !== 'object') fail('roles object is required');
  const missing = ROLES.filter((r) => !config.roles[r]);
  if (missing.length) fail(`missing roles: ${missing.join(', ')}`);
  const extra = Object.keys(config.roles).filter((r) => !ROLES.includes(r));
  if (extra.length) fail(`unknown roles: ${extra.join(', ')}`);
  for (const role of ROLES) {
    const c = config.roles[role].command;
    if (!Array.isArray(c) || !c.length || c.some((x) => typeof x !== 'string')) fail(`roles.${role}.command must be a non-empty string array`);
  }
  if (typeof config.outputDir !== 'string' || !config.outputDir) fail('outputDir is required');
  return config;
}

// Per-round inbox: rejects stale-round and duplicate events, resolves when every role has reported.
export class RoundLedger {
  constructor(round, type, roles = ROLES) { this.round = round; this.type = type; this.roles = roles; this.got = new Map(); }
  accept(role, message) {
    if (message.type !== this.type) return { ok: false, reason: 'unexpected-type' };
    if (message.round !== this.round) return { ok: false, reason: 'stale-round' };
    if (!this.roles.includes(role)) return { ok: false, reason: 'unknown-role' };
    if (this.got.has(role)) return { ok: false, reason: 'duplicate' };
    this.got.set(role, message);
    return { ok: true };
  }
  get complete() { return this.got.size === this.roles.length; }
  get missing() { return this.roles.filter((r) => !this.got.has(r)); }
}

export class StressFailure extends Error {
  constructor(code, detail) { super(`${code}: ${JSON.stringify(detail)}`); this.code = code; this.detail = detail; }
}

export class Coordinator {
  constructor(config, { adapterFactory } = {}) {
    this.config = validateConfig(config);
    this.makeAdapter = adapterFactory ?? ((role, c) => new ProcessAdapter(role, c.command, { cwd: c.cwd, env: c.env }));
    this.adapters = new Map();
    this.rejected = [];
    this.roundResults = [];
    this.attestations = {};
    this.editorBaseline = {};
    this.actorStatus = Object.fromEntries(ROLES.map(role => [role, 'starting']));
    this.runId = `stress-${new Date().toISOString().replace(/[:.]/g, '-')}-${config.seed}`;
  }

  // Fresh output directory; never overwrites an earlier run's evidence.
  openOutput() {
    const dir = join(this.config.outputDir, this.runId);
    if (existsSync(dir)) throw new StressFailure('output-exists', { dir });
    mkdirSync(this.config.outputDir, { recursive: true });
    mkdirSync(dir, { mode: 0o700 });
    mkdirSync(join(dir, 'adapters'));
    this.dir = dir;
    this.resultsPath = join(dir, 'results.jsonl');
    writeFileSync(this.resultsPath, '');
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({seed:this.config.seed, fixture:this.config.fixture, rounds:planRounds(this.config.seed, this.config.rounds)}, null, 2));
    this.record('run-start', { runId: this.runId, seed: this.config.seed, rounds: this.config.rounds, mode: this.config.mode, fixture: this.config.fixture });
    this.writeDashboard('running');
  }

  record(type, detail) {
    const at = new Date().toISOString();
    let line = JSON.stringify({ at, ...detail, type });
    if (line.length > 16384) line = JSON.stringify({ at, type, truncated: true, preview: line.slice(0, 4096) });
    appendFileSync(this.resultsPath, `${redact(line)}\n`);
  }

  async run() {
    this.openOutput();
    let status = 'passed'; let failure = null;
    try {
      await this.startAdapters();
      const initial = this.collect(0, 'state');
      this.broadcast({ type: 'observe', round: 0, expectedEditIds: [] });
      const baseline = await initial;
      const texts = ROLES.map(role => baseline.get(role).text);
      if (texts.some(text => typeof text !== 'string' || text.length > MAX_TEXT) || new Set(texts.map(normalizeText)).size !== 1) throw new StressFailure('baseline-divergence', {});
      this.baseline = normalizeText(texts[0]);
      for (const role of EDITOR_ROLES) this.checkEditor(0, role, baseline.get(role).editor);
      for (const plan of planRounds(this.config.seed, this.config.rounds)) await this.runRound(plan);
    } catch (error) {
      status = 'failed';
      failure = error instanceof StressFailure ? { code: error.code, detail: error.detail } : { code: 'unexpected', detail: { message: String(error?.message ?? error) } };
      this.record('failure', failure);
    } finally {
      await this.stopAdapters();
    }
    const summary = {
      runId: this.runId, status, failure, mode: this.config.mode,
      // Simulated runs never count as real acceptance, whatever their status.
      acceptance: status === 'passed' && this.config.mode === 'real' ? 'six-client-append-only' : 'none',
      roundsCompleted: this.roundResults.length, roundsPlanned: this.config.rounds, rejected: this.rejected.length,
      attestations: this.attestations, outputDir: this.dir,
    };
    writeFileSync(join(this.dir, 'summary.json'), JSON.stringify(summary, null, 2));
    this.record('run-end', summary);
    this.writeDashboard(status, failure);
    return summary;
  }

  async startAdapters() {
    for (const role of ROLES) {
      const adapter = this.makeAdapter(role, this.config.roles[role]);
      adapter.on('reject', (r) => this.reject(r));
      adapter.on('error', (error) => this.record('adapter-error', { role, message: String(error?.message ?? error) }));
      this.adapters.set(role, adapter);
    }
    const pending = this.collect(0, 'attest');
    for (const [role, adapter] of this.adapters) {
      adapter.start();
      adapter.send({ type: 'hello', runId: this.runId, role, mode: this.config.mode, fixture: this.config.fixture });
    }
    const attest = await pending;
    this.checkAttestations(attest);
  }

  checkAttestations(attest) {
    const byMachine = {};
    for (const role of ROLES) {
      const a = attest.get(role);
      const f = this.config.fixture;
      if (!MODES.has(a.mode)) throw new StressFailure('attest-mode', { role, mode: a.mode });
      if (a.adapter === 'fake-adapter' && a.mode === 'real') throw new StressFailure('mode-mismatch', { role, reason: 'test adapter cannot provide physical evidence' });
      if (a.mode !== this.config.mode) throw new StressFailure('mode-mismatch', { role, expected: this.config.mode, actual: a.mode });
      if (a.workspaceId !== f.workspaceId || a.itemId !== f.itemId) throw new StressFailure('fixture-mismatch', { role, expected: f, actual: { workspaceId: a.workspaceId, itemId: a.itemId } });
      if (typeof a.machineId !== 'string' || !a.machineId) throw new StressFailure('machine-missing', { role });
      const m = machineOf(role);
      if (byMachine[m] && byMachine[m] !== a.machineId) throw new StressFailure('machine-mismatch', { machine: m, role, expected: byMachine[m], actual: a.machineId });
      byMachine[m] = a.machineId;
      this.attestations[role] = { mode: a.mode, machineId: a.machineId, adapter: String(a.adapter ?? 'unknown').slice(0, 80) };
    }
    if (byMachine.mac === byMachine.pc) throw new StressFailure('machine-shared', { machineId: byMachine.mac });
    this.record('attested', { attestations: this.attestations });
  }

  // Wait until every role sends `type` for `round`, within the bounded timeout. Stale/duplicate events are rejected.
  collect(round, type, roles = ROLES) {
    const ledger = new RoundLedger(round, type, roles);
    return new Promise((resolve, reject) => {
      const listeners = new Map();
      const done = (fn) => { clearTimeout(timer); for (const [role, l] of listeners) { this.adapters.get(role).off('message', l.m); this.adapters.get(role).off('exit', l.e); this.adapters.get(role).off('error', l.err); } fn(); };
      const timer = setTimeout(() => done(() => reject(new StressFailure('timeout', { round, phase: type, missing: ledger.missing, timeoutMs: this.config.timeoutMs }))), this.config.timeoutMs);
      for (const role of ROLES) {
        const adapter = this.adapters.get(role);
        const l = {
          err: () => done(() => reject(new StressFailure('adapter-error', { round, role }))),
          m: (message) => {
            if (message.type === 'error') return done(() => reject(new StressFailure('actor-failed', { round, role, message: redact(String(message.message ?? '')).slice(0, 500) })));
            const r = ledger.accept(role, message);
            if (!r.ok) return this.reject({ role, reason: r.reason, event: { round: message.round, type: message.type }, expected: { round, type } });
            this.actorStatus[role] = `round ${round}: ${type}`;
            this.writeDashboard('running');
            if (ledger.complete) done(() => resolve(ledger.got));
          },
          e: (exit) => done(() => reject(new StressFailure('actor-exited', { round, role, ...exit, stderr: adapter.stderr.slice(-2000) }))),
        };
        if (adapter.exit) return done(() => reject(new StressFailure('actor-exited', { round, role, ...adapter.exit })));
        adapter.on('message', l.m); adapter.on('exit', l.e); adapter.on('error', l.err); listeners.set(role, l);
      }
    });
  }

  reject(detail) {
    if (this.rejected.length < 1000) { this.rejected.push(detail); this.record('rejected', detail); }
  }
  broadcast(message) { for (const a of this.adapters.values()) a.send(message); }

  async runRound({ round, edits }) {
    const started = Date.now();
    const ready = this.collect(round, 'ready');
    this.broadcast({ type: 'prepare', round });
    await ready;
    const pending = this.collect(round, 'applied');                       // all-ready barrier
    for (const edit of edits) this.adapters.get(edit.role).send({ type: 'edit', round, edit: { id: edit.id, op: edit.op, text: edit.text } }); // concurrent dispatch
    const applied = await pending;
    for (const edit of edits) if (applied.get(edit.role).editId !== edit.id) throw new StressFailure('applied-mismatch', { round, role: edit.role, expected: edit.id, actual: applied.get(edit.role).editId });
    const expectedEditIds = planRounds(this.config.seed, round).flatMap((p) => p.edits.map((e) => e.id)).sort();
    const observing = this.collect(round, 'state');
    this.broadcast({ type: 'observe', round, expectedEditIds });
    const states = await observing;
    const observed = {};
    for (const role of ROLES) {
      const s = states.get(role);
      if (typeof s.text !== 'string' || s.text.length > MAX_TEXT) throw new StressFailure('state-invalid', { round, role, reason: 'text missing or over bound' });
      writeFileSync(join(this.dir, 'adapters', `${role}.last-state.json`), JSON.stringify({round, text:s.text, editor:s.editor, editIds:s.editIds}));
      observed[role] = { hash: hashText(s.text), editIds: [...new Set(Array.isArray(s.editIds) ? s.editIds : [])].sort(), editor: s.editor };
    }
    const hashes = new Set(Object.values(observed).map((o) => o.hash));
    const evidence = Object.fromEntries(ROLES.map((r) => [r, { hash: observed[r].hash, editIds: observed[r].editIds }]));
    if (hashes.size !== 1) throw new StressFailure('hash-divergence', { round, evidence });
    for (const role of ROLES) {
      const ids = observed[role].editIds;
      if (ids.length !== expectedEditIds.length || ids.some((id, i) => id !== expectedEditIds[i])) throw new StressFailure('edit-id-mismatch', { round, role, expected: expectedEditIds, actual: ids });
    }
    for (const role of ROLES) {
      let remaining = normalizeText(states.get(role).text);
      for (const edit of planRounds(this.config.seed, round).flatMap(p => p.edits)) {
        if (remaining.split(edit.text).length !== 2) throw new StressFailure('content-mismatch', { round, role, editId: edit.id });
        remaining = remaining.replace(edit.text, '');
      }
      if (remaining !== this.baseline) throw new StressFailure('baseline-lost', { round, role });
    }
    for (const role of EDITOR_ROLES) this.checkEditor(round, role, observed[role].editor);
    const result = { round, hash: [...hashes][0], editCount: expectedEditIds.length, durationMs: Date.now() - started };
    this.roundResults.push(result);
    this.record('round', result);
    this.writeDashboard('running');
  }

  // App/web editors must keep the same editor session with no reload across rounds.
  checkEditor(round, role, editor) {
    if (!editor || typeof editor.sessionId !== 'string' || editor.reloads !== 0) throw new StressFailure('editor-discontinuity', { round, role });
    const base = this.editorBaseline[role];
    if (!base) { this.editorBaseline[role] = { sessionId: editor.sessionId, reloads: editor.reloads }; return; }
    if (base.sessionId !== editor.sessionId || base.reloads !== editor.reloads) throw new StressFailure('editor-discontinuity', { round, role, baseline: base, actual: { sessionId: editor.sessionId, reloads: editor.reloads } });
  }

  async stopAdapters() {
    await Promise.all([...this.adapters.values()].map(async (a) => {
      const exit = await a.stop();
      if (a.stderr) writeFileSync(join(this.dir, 'adapters', `${a.role}.stderr.log`), a.stderr);
      this.record('adapter-stopped', { role: a.role, exit });
    }));
  }

  writeDashboard(status, failure = null) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const rows = this.roundResults.map((r) => `<tr><td>${r.round}</td><td><code>${r.hash.slice(0, 16)}</code></td><td>${r.editCount}</td><td>${r.durationMs} ms</td></tr>`).join('');
    const refresh = status === 'running' ? '<meta http-equiv="refresh" content="2">' : '';
    const html = `<!doctype html><html><head><meta charset="utf-8">${refresh}<title>Sync stress ${esc(this.runId)}</title>
<style>body{font:14px system-ui;margin:2rem;color:#1a1a1a;background:#fff}@media(prefers-color-scheme:dark){body{color:#e6e6e6;background:#111}}
table{border-collapse:collapse}td,th{padding:.3rem .8rem;border-bottom:1px solid #8884;text-align:left}.failed{color:#c0392b}.passed{color:#1e8449}pre{white-space:pre-wrap;max-height:20rem;overflow:auto}</style></head>
<body><h1>Sync stress <small>${esc(this.runId)}</small></h1>
<p>Status: <strong class="${esc(status)}">${esc(status)}</strong> · mode ${esc(this.config.mode)} · seed ${this.config.seed} · rounds ${this.roundResults.length}/${this.config.rounds} · rejected events ${this.rejected.length}</p>
<table><thead><tr><th>Participant</th><th>Progress</th></tr></thead><tbody>${ROLES.map(role => `<tr><td>${role}</td><td>${esc(this.actorStatus[role])}</td></tr>`).join('')}</tbody></table>
${this.config.mode === 'simulated' ? '<p><em>Simulated evidence. Not real acceptance.</em></p>' : ''}
${failure ? `<h2 class="failed">Failure ${esc(failure.code)}</h2><pre>${esc(JSON.stringify(failure.detail, null, 2).slice(0, 8000))}</pre>` : ''}
<table><thead><tr><th>Round</th><th>Hash</th><th>Edits</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Attestations</h2><pre>${esc(JSON.stringify(this.attestations, null, 2))}</pre></body></html>`;
    writeFileSync(join(this.dir, 'dashboard.html'), html);
  }
}
