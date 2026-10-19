import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot, run } from './resource-sampler.mjs';
import { validateSeries } from './resource-telemetry.mjs';
if (!process.argv[2] || !isAbsolute(process.argv[2])) throw Error('Explicit disposable evidence directory required');
const root = realpathSync(process.argv[2]), sha = b => createHash('sha256').update(b).digest('hex');
const child = spawn(process.execPath, ['-e', 'const end=Date.now()+18000;const t=setInterval(()=>{let n=0;for(let i=0;i<20000;i++)n+=Math.sin(i);if(Date.now()>=end)clearInterval(t)},50)'], { stdio: 'ignore', windowsHide: true });
const exit = new Promise(r => child.on('exit', (code, signal) => r({ code, signal })));
let observed;
try {
    const first = readSnapshot(child.pid);
    if (first.error || !first.processes.some(p => p.identity.pid === child.pid))
        throw Error('Actual child capture unavailable');
    const id = first.processes.find(p => p.identity.pid === child.pid).identity;
    if (id.pid !== child.pid || id.executableSha256 !== sha(readFileSync(realpathSync(process.execPath))))
        throw Error('Actual spawned child mismatch');
    const proof = { runId: 'stage1-fixed-' + process.platform, role: process.platform === 'darwin' ? 'mac-cli' : 'pc-cli', sourceCommit: 'b4b74765840dbecef53b30d08126d59b722f28fa', root: id, kind: 'actual-owned-child-spawn', noProductRuntime: true };
    const evidence = JSON.stringify(proof), ownershipEvidenceFile = join(root, 'actual-main-' + process.platform + '-ownership.json');
    writeFileSync(ownershipEvidenceFile, evidence, { flag: 'wx' });
    const scope = { version: 1, runId: proof.runId, role: proof.role, sourceCommit: proof.sourceCommit, ownershipEvidenceSha256: sha(evidence), root: id }, output = join(root, 'actual-main-' + process.platform + '-samples.jsonl');
    const result = await run({ scope, ownershipEvidenceFile, output, durationMs: 10000, cadenceMs: 5000 });
    if (result.status !== 'complete')
        throw Error('Actual samples incomplete');
    const samples = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
    validateSeries(samples, scope);
    if (samples.length !== 3 || samples.some(v => !v.complete) || samples.slice(1).some(v => v.metrics.cpuCores === null))
        throw Error('Actual raw metric proof missing');
    observed = { status: 'passed', platform: process.platform, samples: 3, rootIdentity: id, metrics: samples.map(v => v.metrics), noProductRuntime: true, noProcessSignals: true, ownershipEvidenceSha256: scope.ownershipEvidenceSha256 };
}
catch (e) {
    observed = { status: 'failed', reason: 'bounded-owned-child-sample-refused', noProductRuntime: true, noProcessSignals: true };
}
const ended = await exit;
observed.exit = ended;
if (ended.code !== 0 || ended.signal !== null)
    observed.status = 'failed';
writeFileSync(join(root, 'actual-main-' + process.platform + '-result.json'), JSON.stringify(observed, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ status: observed.status, platform: process.platform, samples: observed.samples, exit: ended }));
if (observed.status !== 'passed')
    process.exitCode = 1;
