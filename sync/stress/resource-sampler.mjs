import { spawnSync } from 'node:child_process';
import { readFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { binding, sample, createSeriesValidator, LIMITS } from './resource-telemetry.mjs';
export function readSnapshot(pid, platform = process.platform) {
    const mac = platform === 'darwin', program = mac ? 'python3' : 'powershell.exe', args = mac ? [fileURLToPath(new URL('./resource-snapshot-mac.py', import.meta.url)), String(pid)] : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./resource-snapshot-pc.ps1', import.meta.url)), '-RootPid', String(pid)];
    if (!['darwin', 'win32'].includes(platform))
        throw Error('Unsupported physical sampler platform');
    const r = spawnSync(program, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (r.status !== 0)
        return { observedUtc: new Date().toISOString(), processes: [], error: 'unavailable' };
    try {
        return JSON.parse(r.stdout.replace(/^\uFEFF/, ''));
    }
    catch {
        return { observedUtc: new Date().toISOString(), processes: [], error: 'unavailable' };
    }
}
export async function run({ scope, output, ownershipEvidenceFile, durationMs, cadenceMs = 5000, read = readSnapshot, clock = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    scope = binding(scope);
    const evidence = readFileSync(ownershipEvidenceFile);
    if (evidence.length > 65536 || createHash('sha256').update(evidence).digest('hex') !== scope.ownershipEvidenceSha256)
        throw Error('Ownership evidence mismatch');
    const proof = JSON.parse(evidence);
    if (proof.runId !== scope.runId || proof.role !== scope.role || proof.sourceCommit !== scope.sourceCommit || JSON.stringify(proof.root) !== JSON.stringify(scope.root))
        throw Error('Ownership scope mismatch');
    if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > LIMITS.maxMs || !Number.isSafeInteger(cadenceMs) || cadenceMs < 1000 || cadenceMs > 60000 || Math.floor(durationMs / cadenceMs) + 1 > LIMITS.maxSamples)
        throw Error('Finite sampler bounds invalid');
    const file = openSync(output, 'wx', 0o600), start = clock(), validator = createSeriesValidator(scope);
    let previous = null, bytes = 0, count = 0, incomplete = 0;
    try {
        for (let index = 0;; index++) {
            const dueMs = start + index * cadenceMs;
            if (dueMs > start + durationMs)
                break;
            while (clock() < dueMs)
                await sleep(dueMs - clock());
            const captureStart = clock(), raw = read(scope.root.pid), captureDurationMs = clock() - captureStart, v = sample({ scope, index, monotonicMs: captureStart, dueMs, raw, previous, cadenceMs, captureDurationMs });
            validator.push(v);
            const line = JSON.stringify(v) + '\n';
            bytes += Buffer.byteLength(line);
            if (bytes > LIMITS.maxBytes)
                throw Error('Sampler evidence bound');
            writeSync(file, line);
            previous = v;
            count++;
            if (!v.complete)
                incomplete++;
            if (clock() > start + durationMs + 10000)
                throw Error('Sampler total deadline');
        }
        return { status: incomplete ? 'incomplete' : 'complete', samples: count, incomplete, bytes, noProcessSignals: true };
    }
    finally {
        closeSync(file);
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    run(config).then(r => console.log(JSON.stringify(r)), () => { console.error('Finite sampler refused; evidence retained'); process.exitCode = 1; });
}
