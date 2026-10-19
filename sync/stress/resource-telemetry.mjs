export const LIMITS = Object.freeze({ version: 1, maxMs: 7200000, maxSamples: 1441, maxProcesses: 256, maxBytes: 8 * 1024 * 1024 });
const ownData = (o, array = false) => {
    try {
        if (!o || typeof o !== 'object' || (array ? Object.getPrototypeOf(o) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(o))))
            return null;
        const keys = Reflect.ownKeys(o), data = {};
        for (const key of keys) {
            if (typeof key !== 'string')
                return null;
            const d = Object.getOwnPropertyDescriptor(o, key);
            if (!d || !Object.hasOwn(d, 'value') || (!d.enumerable && !(array && key === 'length')))
                return null;
            data[key] = d.value;
        }
        return data;
    }
    catch {
        return null;
    }
};
const exact = (o, keys) => {
    const data = ownData(o);
    return data !== null && Reflect.ownKeys(data).sort().join(',') === [...keys].sort().join(',');
};
const dataArray = v => {
    const data = ownData(v, true);
    return data !== null && Number.isSafeInteger(data.length) && data.length >= 0 && Reflect.ownKeys(data).length === data.length + 1 && Array.from({ length: data.length }, (_, i) => String(i)).every(k => Object.hasOwn(data, k));
};
const integer = n => Number.isSafeInteger(n) && n >= 0;
const hash = s => typeof s === 'string' && s.length === 64 && /^[a-f0-9]+$/.test(s);
export function identity(v) {
    if (!exact(v, ['pid', 'parentPid', 'startKey', 'session', 'executableSha256']) || !Number.isSafeInteger(v.pid) || v.pid < 1 || !integer(v.parentPid) || typeof v.startKey !== 'string' || v.startKey.length < 1 || v.startKey.length > 100 || typeof v.session !== 'string' || !/^[0-9]+$/.test(v.session) || !hash(v.executableSha256))
        throw Error('Invalid owned process identity');
    return structuredClone(v);
}
export function binding(v) {
    if (!exact(v, ['version', 'runId', 'role', 'sourceCommit', 'ownershipEvidenceSha256', 'root']) || v.version !== 1 || typeof v.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.runId) || typeof v.role !== 'string' || !/^(mac|pc)-(app|web|cli)$/.test(v.role) || (typeof v.sourceCommit !== 'string' || v.sourceCommit.length !== 40 || !/^([a-f0-9]{40})$/.test(v.sourceCommit)) || !hash(v.ownershipEvidenceSha256))
        throw Error('Invalid sampler binding');
    identity(v.root);
    return structuredClone(v);
}
export function rawSnapshot(v) {
    if (!exact(v, ['observedUtc', 'processes', 'error']) || typeof v.observedUtc !== 'string' || !Number.isFinite(Date.parse(v.observedUtc)) || !dataArray(v.processes) || v.processes.length > LIMITS.maxProcesses || ![null, 'unavailable', 'identity-changed', 'tree-unavailable', 'process-bound'].includes(v.error))
        throw Error('Invalid process snapshot');
    const seen = new Set();
    for (const p of v.processes) {
        if (!exact(p, ['identity', 'cpuSeconds', 'rssBytes', 'privateBytes']) || typeof p.cpuSeconds !== 'number' || !Number.isFinite(p.cpuSeconds) || p.cpuSeconds < 0 || !integer(p.rssBytes) || (p.privateBytes !== null && !integer(p.privateBytes)))
            throw Error('Invalid process metrics');
        identity(p.identity);
        if (seen.has(p.identity.pid))
            throw Error('Duplicate process identity');
        seen.add(p.identity.pid);
    }
    return structuredClone(v);
}
const same = (a, b) => ['pid', 'parentPid', 'startKey', 'session', 'executableSha256'].every(k => a?.[k] === b?.[k]);
const reachesRoot = (processes, rootPid) => {
    const parents = new Map(processes.map(p => [p.identity.pid, p.identity.parentPid]));
    if (!parents.has(rootPid))
        return false;
    for (const pid of parents.keys()) {
        const seen = new Set();
        let at = pid;
        while (at !== rootPid) {
            if (seen.has(at) || !parents.has(at))
                return false;
            seen.add(at);
            at = parents.get(at);
        }
    }
    return true;
};
export function sample({ scope, index, monotonicMs, dueMs, raw, previous = null, cadenceMs, captureDurationMs = 0 }) {
    binding(scope);
    rawSnapshot(raw);
    if (!Number.isFinite(captureDurationMs) || captureDurationMs < 0)
        throw Error('Invalid capture duration');
    if (!integer(index) || index >= LIMITS.maxSamples || !Number.isFinite(monotonicMs) || monotonicMs < 0 || !Number.isFinite(dueMs) || dueMs < 0 || !integer(cadenceMs) || cadenceMs < 1000)
        throw Error('Invalid sampler clock');
    let reason = raw.error;
    const root = raw.processes.find(p => p.identity.pid === scope.root.pid);
    if (!root)
        reason ??= 'unavailable';
    else if (!same(root.identity, scope.root))
        reason = 'identity-changed';
    if (!reachesRoot(raw.processes, scope.root.pid))
        reason ??= 'tree-unavailable';
    if (captureDurationMs > cadenceMs)
        reason ??= 'capture-overrun';
    if (monotonicMs < dueMs || monotonicMs - dueMs > Math.min(1000, cadenceMs / 5))
        reason ??= 'cadence-gap';
    let cpuDelta = null, cpuCores = null;
    if (previous) {
        if (index !== previous.index + 1 || monotonicMs <= previous.monotonicMs)
            throw Error('Stale or nonmonotonic sample');
        const old = new Map(previous.raw.processes.map(p => [p.identity.pid, p]));
        if (old.size !== raw.processes.length || raw.processes.some(p => !old.has(p.identity.pid) || !same(p.identity, old.get(p.identity.pid).identity)))
            reason ??= 'tree-membership-changed';
        else if (raw.processes.some(p => p.cpuSeconds < old.get(p.identity.pid).cpuSeconds))
            reason ??= 'counter-regressed';
        else if (!reason && !previous.reason) {
            cpuDelta = raw.processes.reduce((n, p) => n + p.cpuSeconds - old.get(p.identity.pid).cpuSeconds, 0);
            cpuCores = cpuDelta / ((monotonicMs - previous.monotonicMs) / 1000);
        }
    }
    const complete = reason === null;
    return { version: 1, kind: 'owned-process-resources', runId: scope.runId, role: scope.role, sourceCommit: scope.sourceCommit, ownershipEvidenceSha256: scope.ownershipEvidenceSha256, sampleId: scope.runId + ':resources:' + index, index, monotonicMs, dueMs, captureDurationMs, cadenceMs, reason, complete, raw, metrics: { rssBytes: complete ? raw.processes.reduce((n, p) => n + p.rssBytes, 0) : null, privateBytes: complete && raw.processes.every(p => p.privateBytes !== null) ? raw.processes.reduce((n, p) => n + p.privateBytes, 0) : null, cpuDeltaSeconds: complete ? cpuDelta : null, cpuCores: complete ? cpuCores : null } };
}
function parseTelemetry(v, scope, allowCpu) {
    binding(scope);
    const keys = ['version', 'kind', 'runId', 'role', 'sourceCommit', 'ownershipEvidenceSha256', 'sampleId', 'index', 'monotonicMs', 'dueMs', 'captureDurationMs', 'cadenceMs', 'reason', 'complete', 'raw', 'metrics'];
    if (!exact(v, keys) || v.version !== 1 || v.kind !== 'owned-process-resources' || ['runId', 'role', 'sourceCommit', 'ownershipEvidenceSha256'].some(k => v[k] !== scope[k]) || !integer(v.index) || v.index >= LIMITS.maxSamples || v.sampleId !== scope.runId + ':resources:' + v.index || !Number.isFinite(v.monotonicMs) || !Number.isFinite(v.dueMs) || v.monotonicMs < 0 || v.dueMs < 0 || !Number.isFinite(v.captureDurationMs) || v.captureDurationMs < 0 || !integer(v.cadenceMs) || v.cadenceMs < 1000 || v.cadenceMs > 60000 || typeof v.complete !== 'boolean' || ![null, 'unavailable', 'identity-changed', 'tree-unavailable', 'process-bound', 'cadence-gap', 'tree-membership-changed', 'counter-regressed', 'capture-overrun'].includes(v.reason) || v.complete !== (v.reason === null))
        throw Error('Invalid telemetry envelope');
    rawSnapshot(v.raw);
    if (!exact(v.metrics, ['rssBytes', 'privateBytes', 'cpuDeltaSeconds', 'cpuCores']))
        throw Error('Invalid telemetry metrics');
    for (const [k, n] of Object.entries(v.metrics))
        if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (['rssBytes', 'privateBytes'].includes(k) && !integer(n))))
            throw Error('Invalid telemetry metric');
    if (!v.complete && Object.values(v.metrics).some(n => n !== null))
        throw Error('Incomplete metrics must be null');
    if (v.complete && !reachesRoot(v.raw.processes, scope.root.pid))
        throw Error('Unreachable process tree');
    if (v.complete && (v.metrics.rssBytes !== v.raw.processes.reduce((n, p) => n + p.rssBytes, 0) || v.raw.error !== null || !v.raw.processes.some(p => same(p.identity, scope.root))))
        throw Error('Complete telemetry lacks bound root');
    const base = sample({ scope, index: v.index, monotonicMs: v.monotonicMs, dueMs: v.dueMs, captureDurationMs: v.captureDurationMs, cadenceMs: v.cadenceMs, raw: v.raw });
    if (v.complete && !base.complete)
        throw Error('Forged complete status');
    if (!allowCpu && ['tree-membership-changed', 'counter-regressed'].includes(v.reason))
        throw Error('Prior sample status requires validated series');
    const expectedPrivate = v.raw.processes.every(p => p.privateBytes !== null) ? v.raw.processes.reduce((n, p) => n + p.privateBytes, 0) : null;
    if (v.complete && v.metrics.privateBytes !== expectedPrivate)
        throw Error('Forged private memory total');
    if ((v.metrics.cpuDeltaSeconds === null) !== (v.metrics.cpuCores === null))
        throw Error('Incomplete CPU pair');
    if (!allowCpu && (v.metrics.cpuDeltaSeconds !== null || v.metrics.cpuCores !== null))
        throw Error('CPU claims require validated sample series');
    return structuredClone(v);
}
// A standalone DTO is not CPU-rate authority. Use the series validator for deltas.
export function telemetry(v, scope) { return parseTelemetry(v, scope, false); }
export function createSeriesValidator(scope) {
    scope = binding(scope);
    let previous = null, start = null, cadence = null;
    return {
        push(value) {
            const v = parseTelemetry(value, scope, true);
            if (!previous && v.index !== 0)
                throw Error('Series must start at zero');
            if (previous && (v.index !== previous.index + 1 || v.monotonicMs <= previous.monotonicMs || v.cadenceMs !== cadence))
                throw Error('Stale or drifting series');
            if (!previous) {
                start = v.dueMs;
                cadence = v.cadenceMs;
            }
            if (v.dueMs !== start + v.index * cadence)
                throw Error('Forged due time');
            const expected = sample({ scope, index: v.index, monotonicMs: v.monotonicMs, dueMs: v.dueMs, captureDurationMs: v.captureDurationMs, cadenceMs: v.cadenceMs, raw: v.raw, previous });
            for (const key of ['reason', 'complete'])
                if (v[key] !== expected[key])
                    throw Error('Forged sample status');
            for (const key of Object.keys(expected.metrics))
                if (v.metrics[key] !== expected.metrics[key])
                    throw Error('Forged derived metric');
            previous = expected;
            return structuredClone(expected);
        }
    };
}
export function validateSeries(values, scope) {
    if (!dataArray(values) || !values.length || values.length > LIMITS.maxSamples)
        throw Error('Invalid sample series');
    const validator = createSeriesValidator(scope);
    return values.map(v => validator.push(v));
}
