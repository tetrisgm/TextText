#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, pause, preflight, readMailbox, writeMailbox, lines, lineValue, runtimeBound } from './stress-browser-relay.mjs';
export async function pump({ session, spawnAdapter, inspect = async () => { }, maxMs = LIMITS.defaultMs, now = Date.now }) {
    const child = spawnAdapter();
    let output = 0, request = 0, failed = false, shutdown = false, exited, stderr = 0, stderrChunks = [], inspections = Promise.resolve();
    const start = now(), bound = runtimeBound(maxMs);
    writeFileSync(join(session, 'adapter-pid.json'), JSON.stringify({ pid: child.pid, started: new Date().toISOString() }), { flag: 'wx' });
    child.stdin.on('error', () => { failed = true; });
    const closed = new Promise(r => child.once('close', (code, signal) => { exited = { code, signal }; r(exited); }));
    child.once('error', () => { failed = true; exited = { code: -1, signal: null }; });
    child.stderr.on('data', bytes => { if (stderr < LIMITS.stderrBytes)
        stderrChunks.push(bytes.subarray(0, LIMITS.stderrBytes - stderr)); stderr += bytes.length; });
    const diagnostics = () => { const text = Buffer.concat(stderrChunks).toString('utf8').replace(/\b(token|secret|password|passwd|cookie|authorization|api[_-]?key|bearer)\b(\s*[:=]\s*|\s+)(bearer\s+)?[^\s"']+/gi, (_, key) => key + '=[redacted]'); writeFileSync(join(session, 'adapter-stderr.log'), text, { flag: 'wx' }); stderrChunks = []; };
    lines(child.stdout, line => { const value = lineValue(line, true); inspections = inspections.then(async () => { if (value.type === 'attest')
        await inspect(); writeMailbox(session, 'out', ++output, line); if (value.type === 'error') {
        failed = true;
        if (!shutdown) {
            shutdown = true;
            child.stdin.end(JSON.stringify({ type: 'shutdown' }) + '\n');
        }
    } }).catch(() => { failed = true; writeFileSync(join(session, 'held-output.jsonl'), line + '\n', { flag: 'wx' }); if (!shutdown) {
        shutdown = true;
        child.stdin.end(JSON.stringify({ type: 'shutdown' }) + '\n');
    } }); }, LIMITS.replyChars, () => { failed = true; if (!shutdown) {
        shutdown = true;
        child.stdin.end(JSON.stringify({ type: 'shutdown' }) + '\n');
    } });
    let grace, requestRejected = false;
    for (;;) {
        if (exited)
            break;
        try {
            const raw = requestRejected ? null : readMailbox(session, 'req', request + 1);
            if (raw !== null) {
                request++;
                const value = lineValue(raw);
                if (shutdown && value.type !== 'shutdown') {
                    failed = true;
                }
                else if (!shutdown) {
                    child.stdin.write(raw + '\n');
                    if (value.type === 'shutdown') {
                        shutdown = true;
                        child.stdin.end();
                    }
                }
            }
        }
        catch {
            failed = true;
            requestRejected = true;
            if (!shutdown) {
                shutdown = true;
                child.stdin.end(JSON.stringify({ type: 'shutdown' }) + '\n');
            }
        }
        if (now() - start >= bound && !shutdown) {
            failed = true;
            shutdown = true;
            child.stdin.end(JSON.stringify({ type: 'shutdown' }) + '\n');
        }
        if (shutdown && grace === undefined)
            grace = now() + 30000;
        if (grace !== undefined && now() > grace) {
            await inspections;
            const retained = { code: 1, failed: true, retained: true, adapterPid: child.pid, forceTermination: false };
            diagnostics();
            writeFileSync(join(session, 'child-exit.json'), JSON.stringify(retained), { flag: 'wx' });
            child.unref?.();
            for (const pipe of [child.stdin, child.stdout, child.stderr])
                pipe?.unref?.();
            return retained;
        }
        await pause(25);
    }
    await closed;
    await inspections;
    const result = { ...exited, code: failed || exited.code !== 0 ? 1 : 0, adapterExitCode: exited.code, stderrTruncated: stderr > LIMITS.stderrBytes, retained: false, forceTermination: false };
    diagnostics();
    writeFileSync(join(session, 'child-exit.json'), JSON.stringify(result), { flag: 'wx' });
    return result;
}
async function main() {
    if (process.platform !== 'win32')
        throw Error('Windows interactive browser child required');
    const [driver, configPath, session, budget] = process.argv.slice(2);
    const maxMs = runtimeBound(budget), plan = preflight(driver, configPath, session, { existingSession: true });
    const query = '$p=Get-Process -Id ' + process.pid + ';@{pid=$p.Id;sessionId=$p.SessionId;startUtc=$p.StartTime.ToUniversalTime().ToString(\'o\')}|ConvertTo-Json';
    const observed = spawnSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16384 });
    if (observed.status !== 0)
        throw Error('Interactive child identity unavailable');
    const identity = JSON.parse(observed.stdout.replace(/^\uFEFF/, ''));
    if (identity.pid !== process.pid || identity.sessionId <= 0)
        throw Error('Interactive desktop required');
    writeFileSync(join(session, 'child-ready.json'), JSON.stringify(identity), { flag: 'wx' });
    const result = await pump({ session, maxMs, spawnAdapter: () => spawn(process.execPath, [plan.driver, plan.configPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false }) });
    process.exit(result.code);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(() => {
        process.stderr.write('Interactive browser child failed; owned session preserved.\n');
        process.exit(1);
    });
