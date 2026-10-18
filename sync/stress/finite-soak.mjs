// Pure finite dwell protocol. No timers, actor launches, telemetry or acceptance claim.
export const SOAK_ROLES = Object.freeze(['mac-app', 'mac-web', 'mac-cli', 'pc-app', 'pc-web', 'pc-cli']);
export const SOAK_LIMITS = Object.freeze({ durationMs: 3600000, cadenceMs: 30000, responseMs: 20000, dispatchSlackMs: 1000, samples: 121, evidenceBytes: 16 * 1024 * 1024 });
export function validateSoak(value) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'cadenceMs,durationMs,version' || value.version !== 1 || value.durationMs !== SOAK_LIMITS.durationMs || value.cadenceMs !== SOAK_LIMITS.cadenceMs) throw Error('Soak requires exact version1 finite60min cadence30s');
  return Object.freeze({ ...value });
}
export class FiniteSoak {
  constructor({ spec, runId, startMs, identities, oracle }) {
    this.spec = validateSoak(spec);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId) || !Number.isFinite(startMs) || startMs < 0 || typeof oracle !== 'function' || !identities || Object.keys(identities).sort().join(',') !== [...SOAK_ROLES].sort().join(',') || SOAK_ROLES.some(role => !/^[a-f0-9]{64}$/.test(identities[role]))) throw Error('Invalid soak binding');
    this.runId = runId; this.startMs = startMs; this.lastMs = startMs;
    this.identities = Object.freeze({ ...identities }); this.oracle = oracle;
    this.index = 0; this.pending = null; this.bytes = 0; this.failed = false;
  }
  refuse(message) { this.failed = true; throw Error(message); }
  time(now) {
    if (this.failed) throw Error('Soak already failed');
    if (!Number.isFinite(now) || now < this.lastMs) this.refuse('Nonmonotonic soak clock');
    this.lastMs = now;
    if (now > this.startMs + SOAK_LIMITS.durationMs + SOAK_LIMITS.responseMs) this.refuse('Soak total deadline exceeded');
  }
  begin(now) {
    this.time(now);
    if (this.pending || this.index >= SOAK_LIMITS.samples) this.refuse('Overlapping or excess soak sample');
    const due = this.startMs + this.index * SOAK_LIMITS.cadenceMs;
    if (now < due || now > due + SOAK_LIMITS.dispatchSlackMs) this.refuse('Early or missed soak cadence');
    const sampleId = `${this.runId}:soak:${this.index}`;
    this.pending = { sampleId, deadlineMs: due + SOAK_LIMITS.responseMs, observations: new Map() };
    return Object.freeze({ sampleId, deadlineMs: this.pending.deadlineMs, index: this.index });
  }
  receive({ sampleId, role, identity, observation, evidenceBytes }, now) {
    this.time(now);
    const p = this.pending;
    if (!p || sampleId !== p.sampleId || !SOAK_ROLES.includes(role) || p.observations.has(role)) this.refuse('Uncorrelated, unknown or duplicate soak response');
    if (now > p.deadlineMs) this.refuse('Late soak response');
    if (identity !== this.identities[role]) this.refuse('Soak actor/session identity drift');
    if (!Number.isSafeInteger(evidenceBytes) || evidenceBytes < 1 || this.bytes + evidenceBytes > SOAK_LIMITS.evidenceBytes) this.refuse('Soak evidence budget exceeded');
    this.bytes += evidenceBytes;
    // Caller must run its complete document/assets/pending/session oracle; no hash-only substitute.
    let valid;
    try { valid = this.oracle(role, observation, this.index); } catch { this.refuse('Soak full oracle threw'); }
    if (valid !== true) this.refuse('Soak full oracle failed');
    p.observations.set(role, true);
    if (p.observations.size !== SOAK_ROLES.length) return false;
    this.pending = null; this.index += 1; return true;
  }
  check(now) {
    this.time(now);
    if (this.pending && now > this.pending.deadlineMs) this.refuse('Missing soak response');
    if (!this.pending && this.index < SOAK_LIMITS.samples && now > this.startMs + this.index * SOAK_LIMITS.cadenceMs + SOAK_LIMITS.dispatchSlackMs) this.refuse('Missed soak sample');
  }
  result(now) {
    this.check(now);
    if (this.pending || this.index !== SOAK_LIMITS.samples) this.refuse('Incomplete finite dwell');
    return Object.freeze({ status: 'dwell-complete', acceptance: 'partial-not-full-T24', samples: this.index, durationMs: SOAK_LIMITS.durationMs, evidenceBytes: this.bytes, nativeIdleMutations: null, listeners: null, retainedDocuments: null, resources: null });
  }
}
