#!/usr/bin/env node
// Human-invoked transport only. The sealed browser adapter owns all identity,
// authentication, content and browser lifecycle decisions.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, linkSync, unlinkSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { browserLaunchArguments } from '../../sync/stress/browser-launch.mjs';
import { validateConfig } from '../../sync/stress/browser-adapter.mjs';
import { boundedFile, fixedDriverFiles, observeSealedSource } from '../../sync/stress/identity-observation.mjs';
export const LIMITS = { requestChars: 64 * 1024, replyChars: 256 * 1024, totalBytes: 64 * 1024 * 1024, configBytes: 256 * 1024, stderrBytes: 64 * 1024, defaultMs: 420000, maxMs: 7200000 };
export const pause = ms => new Promise(r => setTimeout(r, ms));
export function runtimeBound(value = LIMITS.defaultMs) { const n = Number(value); if (!Number.isInteger(n) || n < 1000 || n > LIMITS.maxMs)
    throw Error('Browser relay runtime outside bound'); return n; }
export function lineValue(line, reply = false) { if (typeof line !== 'string' || line.length > (reply ? LIMITS.replyChars : LIMITS.requestChars))
    throw Error('Browser relay line exceeds supported bound'); const value = JSON.parse(line); if (!value || typeof value !== 'object' || typeof value.type !== 'string')
    throw Error('Browser relay requires a protocol object'); return value; }
export function safeAncestors(path) { if (!isAbsolute(path))
    throw Error('Absolute browser test paths required'); for (let at = resolve(path);; at = dirname(at)) {
    try {
        if (lstatSync(at).isSymbolicLink())
            throw Error('Browser test links refused');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    if (dirname(at) === at)
        break;
} }
export function preflight(driver, configPath, session, { verify = observeSealedSource, existingSession = false } = {}) {
    for (const p of [driver, configPath, session])
        safeAncestors(p);
    const expected = resolve(dirname(fileURLToPath(import.meta.url)), '../../sync/stress/browser-adapter.mjs');
    if (!existsSync(dirname(session)) || !lstatSync(dirname(session)).isDirectory())
        throw Error('Existing owned runner parent required');
    if (resolve(driver) !== expected || realpathSync(driver) !== expected || existsSync(session) !== existingSession)
        throw Error('Exact sealed browser driver and fresh session required');
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(boundedFile(configPath, LIMITS.configBytes)));
    if (raw.role !== 'pc-web' || (raw.headless !== undefined && raw.headless !== false) || (raw.channel !== undefined && raw.channel !== 'msedge'))
        throw Error('PC web role and headed Microsoft Edge required');
    const config = validateConfig(raw);
    if (config.auth !== 'saved-app' || resolve(config.profile) !== join(resolve(session), 'browser-profile') || existsSync(config.profile))
        throw Error('Fresh runner-owned saved-app browser profile required');
    if (!config.identityReceipt)
        throw Error('Sealed browser identity receipt required');
    safeAncestors(config.identityReceipt);
    const source = verify(config.identityReceipt, 'pc-web', fixedDriverFiles('pc-web'));
    return { driver: expected, configPath: resolve(configPath), session: resolve(session), profile: resolve(config.profile), source };
}
export function writeMailbox(session, prefix, seq, line) { const name = join(session, `${prefix}-${String(seq).padStart(6, '0')}.jsonl`), temp = name + '.tmp'; writeFileSync(temp, line + '\n', { flag: 'wx', mode: 0o600 }); linkSync(temp, name); unlinkSync(temp); }
export function readMailbox(session, prefix, seq, reply = false) { const file = join(session, `${prefix}-${String(seq).padStart(6, '0')}.jsonl`); if (!existsSync(file))
    return null; const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(boundedFile(file, (reply ? LIMITS.replyChars : LIMITS.requestChars) * 4 + 2)); if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n'))
    throw Error('Mailbox must contain one exact JSONL line'); const line = raw.slice(0, -1); lineValue(line, reply); return line; }
// Bounded streaming decoder preserves JSONL bytes/text, including Unicode.
export function lines(stream, onLine, maxChars, onFailure) { const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); let pending = '', total = 0, failed = false; const fail = e => { if (!failed) {
    failed = true;
    onFailure(e);
} }; stream.on('data', chunk => { if (failed)
    return; total += chunk.length; if (total > LIMITS.totalBytes)
    return fail(Error('Browser relay total output bound')); try {
    pending += decoder.decode(chunk, { stream: true });
}
catch (e) {
    return fail(e);
} for (;;) {
    const i = pending.indexOf('\n');
    if (i < 0)
        break;
    const line = pending.slice(0, i);
    pending = pending.slice(i + 1);
    if (line.length > maxChars)
        return fail(Error('Browser relay line bound'));
    try {
        onLine(line);
    }
    catch (e) {
        return fail(e);
    }
} if (pending.length > maxChars)
    fail(Error('Browser relay line bound')); }); stream.on('error', fail); stream.on('end', () => { try {
    pending += decoder.decode();
}
catch (e) {
    return fail(e);
} if (pending.length)
    fail(Error('Browser relay incomplete JSONL line')); }); }
export async function relay({ session, input, output, start, finish, inspect = async () => { }, now = Date.now, maxMs = LIMITS.defaultMs }) {
    let request = 0, response = 0, failed = false, shutdown = false, eof = false, errorSeen = false;
    const begin = now(), bound = runtimeBound(maxMs);
    const send = line => { const value = lineValue(line); if (errorSeen && value.type !== 'shutdown')
        throw Error('Browser error stops further requests'); if (shutdown)
        throw Error('Request after shutdown refused'); writeMailbox(session, 'req', ++request, line); if (value.type === 'shutdown')
        shutdown = true; };
    await start();
    lines(input, line => { try {
        send(line);
    }
    catch {
        failed = true;
        errorSeen = true;
    } }, LIMITS.requestChars, () => { failed = true; errorSeen = true; });
    input.on('end', () => { eof = true; });
    let grace, outputRejected = false;
    for (;;) {
        try {
            for (; !outputRejected;) {
                const line = readMailbox(session, 'out', response + 1, true);
                if (line === null)
                    break;
                response++;
                const value = lineValue(line, true);
                if (value.type === 'attest' || (value.type === 'restart' && value.attestation?.type === 'attest'))
                    await inspect(value);
                output.write(line + '\n');
                if (value.type === 'error') {
                    failed = true;
                    errorSeen = true;
                }
            }
        }
        catch {
            failed = true;
            errorSeen = true;
            outputRejected = true;
        }
        const exit = join(session, 'child-exit.json');
        if (existsSync(exit)) {
            const result = JSON.parse(boundedFile(exit, 16384));
            if (result.code !== 0 || result.retained)
                failed = true;
            await finish(result);
            return failed ? 1 : 0;
        }
        if ((eof || errorSeen || now() - begin >= bound) && !shutdown) {
            send(JSON.stringify({ type: 'shutdown' }));
            grace = now() + 30000;
            if (now() - begin >= bound)
                failed = true;
        }
        if (shutdown && grace === undefined)
            grace = now() + 30000;
        if (grace !== undefined && now() > grace) {
            writeFileSync(join(session, 'relay-retained.json'), JSON.stringify({ failed: true, forceTermination: false, reason: 'Orderly browser shutdown not proven' }), { flag: 'wx' });
            return 1;
        }
        await pause(50);
    }
}
async function main() {
    if (process.platform !== 'win32')
        throw Error('Interactive browser relay requires Windows');
    const [driver, configPath, session, budget] = process.argv.slice(2);
    const maxMs = runtimeBound(budget), plan = preflight(driver, configPath, session);
    const task = 'TextText-stress-browser-' + randomUUID().replaceAll('-', '');
    const script = fileURLToPath(new URL('./stress-browser-task.ps1', import.meta.url));
    const expected = browserLaunchArguments('win32').find(x => x.startsWith('--disable-features=')).slice('--disable-features='.length);
    const taskCall = mode => {
        const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Driver', plan.driver, '-Config', plan.configPath, '-Session', plan.session, '-Node', process.execPath, '-TaskName', task, '-MaxMs', String(maxMs)];
        if (mode === 'finish')
            args.push('-Finish');
        if (mode === 'inspect')
            args.push('-Inspect', '-ExpectedFeatures', expected);
        const r = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 65536 });
        if (r.status !== 0)
            throw Error('Owned interactive browser task ' + mode + ' refused');
    };
    const code = await relay({
        session: plan.session, input: process.stdin, output: process.stdout, maxMs,
        start: async () => taskCall('start'),
        inspect: async () => taskCall('inspect'),
        finish: async (result) => {
            if (result.code !== 0 || result.retained)
                throw Error('Failed browser remains preserved');
            const until = Date.now() + 30000;
            for (;;) {
                try {
                    taskCall('finish');
                    return;
                }
                catch {
                    if (Date.now() >= until)
                        throw Error('Owned browser exit not proven');
                    await pause(100);
                }
            }
        }
    });
    process.exit(code);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(() => {
        process.stderr.write('Interactive browser transport failed; owned session preserved.\n');
        process.exit(1);
    });
