#!/usr/bin/env node
// Windows SSH JSONL relay for the real interactive WPF/WebView2 stress actor.
// Node owns streaming stdin because PowerShell's SSH Console.In stalls after the
// first line on this host. PowerShell is used only for one-shot task lifecycle.
import { readFileSync, mkdirSync, existsSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, basename, extname, resolve, dirname } from 'node:path';
import { measurementLaunchOptions, prepareLaunchMeasurement } from './measurement-launch-owner.mjs';

const [assembly, configPath, session] = process.argv.slice(2);
const script = new URL('./stress-native-task.ps1', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:\/)/, '');
const taskBase = 'TextText-stress-native-' + randomUUID().replaceAll('-', '');
const fail = (message, round = 0) => process.stdout.write(JSON.stringify({ type: 'error', round, message }) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let generation = 1;
let actorSession;
let lifetimePins;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function nativeTaskLifetimePins(config, configBytes, moduleBytes) {
  const durationKeys = Object.keys(config).filter(key => key.toLowerCase() === 'totalminutes');
  if (durationKeys.length > 1) throw new Error('Ambiguous native actor duration.');
  const actorMinutes = durationKeys.length ? config[durationKeys[0]] : 20;
  if (!Number.isInteger(actorMinutes) || actorMinutes < 1 || actorMinutes > 120) throw new Error('Invalid native actor duration.');
  return {actorMinutes, taskMinutes: Math.max(22, actorMinutes + 2),
    configSha256: digest(configBytes), moduleSha256: digest(moduleBytes)};
}
export function validateNativeTaskLifetime(observed, expected) {
  const limit = typeof observed.actualLimit === 'string' && /^PT(?:(\d{1,3})H)?(?:(\d{1,3})M)?$/.exec(observed.actualLimit);
  const actualMinutes = limit ? Number(limit[1] ?? 0) * 60 + Number(limit[2] ?? 0) : null;
  if (observed.version !== 1 || observed.taskName !== expected.taskName || observed.session !== expected.session ||
      observed.actorMinutes !== expected.actorMinutes || observed.taskMinutes !== expected.taskMinutes ||
      observed.configSha256 !== expected.configSha256 || observed.moduleSha256 !== expected.moduleSha256 ||
      actualMinutes !== expected.taskMinutes)
    throw new Error('Native task lifetime attestation differs from sealed inputs.');
}

const taskName = () => `${taskBase}-${String(generation).padStart(3, '0')}`;
function task(mode = 'start') {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Assembly', assembly, '-Config', configPath, '-Session', actorSession, '-TaskName', taskName(),
    '-ExpectedConfigSha256', lifetimePins.configSha256, '-ExpectedModuleSha256', lifetimePins.moduleSha256];
  if (mode === 'finish') args.push('-Finish');
  if (mode === 'inspect') args.push('-InspectLifetime');
  if (mode === 'crash') args.push('-Crash');
  const result = spawnSync('powershell.exe', args, { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    // The lifecycle script contains only private fixture paths and fixed error
    // strings. Keep its bounded diagnostic in the runner-owned session.
    writeFileSync(join(session, `task-error-${mode}.txt`), String(result.stderr || result.stdout || 'No task output.').slice(0, 4096));
    throw new Error(mode === 'start' ? 'Native actor could not start.' : mode === 'crash' ? 'Native actor could not be terminated.' : 'Native actor did not flush or exit cleanly.');
  }
  if (mode === 'inspect') {
    const observed = JSON.parse(result.stdout);
    validateNativeTaskLifetime(observed, {...lifetimePins, taskName: taskName(), session: actorSession});
  }
  if (mode === 'start') task('inspect');
}
async function finishTask() {
  for (let i = 0; i < 300; i++) {
    try { task('finish'); return; } catch { await pause(100); }
  }
  throw new Error('Native actor remained open after shutdown.');
}
async function reply(seq, limitMs) {
  const file = join(actorSession, `rep-${String(seq).padStart(6, '0')}.json`);
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    if (existsSync(file)) {
      const value = readFileSync(file, 'utf8').trim();
      if (value) return JSON.parse(value);
    }
    await pause(100);
  }
  throw new Error('Native actor did not reply within the bound.');
}
async function request(seq, line, type) {
  const file = join(actorSession, `req-${String(seq).padStart(6, '0')}.json`);
  const tmp = file + '.tmp';
  writeFileSync(tmp, line, { flag: 'wx' });
  renameSync(tmp, file);
  return reply(seq, type === 'hello' ? 120000 : 100000);
}
export async function finishNormalClosedActor({normalClosed,generation,shutdown,finish}) {
  if (!normalClosed || generation !== 1) throw new Error('Native actor has no successful normal close.');
  const ack = await shutdown();
  if (ack?.ok !== true) throw new Error('Native actor normal-close shutdown failed.');
  await finish();
}
async function main() {
  if (![assembly, configPath, session].every(p => typeof p === 'string' && isAbsolute(p))) throw new Error('Absolute test paths are required.');
  if (!existsSync(assembly) || !existsSync(configPath) || existsSync(session)) throw new Error('Test input is missing or the session already exists.');
  if (statSync(configPath).size > 16384) throw new Error('Test config exceeds the bound.');
  const configBytes = readFileSync(configPath);
  const config = JSON.parse(configBytes.toString('utf8'));
  lifetimePins = nativeTaskLifetimePins(config, configBytes, readFileSync(assembly));
  const title = config.Title ?? config.title;
  const file = config.File ?? config.file;
  if (!title?.startsWith('Six-client acceptance ') || basename(file ?? '', extname(file ?? '')) !== title) throw new Error('Not a dedicated acceptance file.');
  const measureOptions = measurementLaunchOptions(process.argv.slice(5));
  const measure = measureOptions.enabled ? prepareLaunchMeasurement(measureOptions, {
    role: 'pc-app', sessionRoot: session, maxMs: null, features: null,
    sealPath: config.IdentityReceipt ?? config.identityReceipt, relayPath: fileURLToPath(import.meta.url),
    files: { module: assembly, config: configPath, task: script,
      helper: join(dirname(script), 'resource-ownership-task.ps1'),
      powershell: join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      executable: join(process.env.LOCALAPPDATA, 'TextTextBuild/dotnet/dotnet.exe') }
  }) : null;
  measure?.beforeStart();
  mkdirSync(session);
  actorSession = join(session, `generation-${String(generation).padStart(3, '0')}`);
  mkdirSync(actorSession);
  task();
  let seq = 0, actorSeq = 0, stopped = false, failed = false, helloLine, attestation, normalClosed = false;
  try {
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      if (line.length > 256 * 1024) { fail('Request exceeds the message bound.'); failed = true; break; }
      let message;
      try { message = JSON.parse(line); } catch { fail('Request is not valid JSON.'); failed = true; break; }
      seq++;
      let answer;
      try {
        if (message.type === 'restart') {
          if (message.graceful !== undefined && message.graceful !== true) throw new Error('Native actor restart lifecycle is unsupported.');
          if (!helloLine || !attestation?.sessionId) throw new Error('Native actor has not attested yet.');
          if (message.graceful === true) {
            await finishNormalClosedActor({normalClosed,generation,shutdown:()=>request(++actorSeq,JSON.stringify({type:'shutdown'}),'shutdown'),finish:finishTask});
          } else { if (normalClosed) throw new Error('Native actor already closed; crash restart refused.'); task('crash'); }
          generation++;
          actorSession = join(session, `generation-${String(generation).padStart(3, '0')}`);
          mkdirSync(actorSession);
          actorSeq = 0;
          measure?.beforeStart();
          task();
          const next = await request(++actorSeq, helloLine, 'hello');
          if (next?.type !== 'attest' || next.generation !== generation || typeof next.sessionId !== 'string' || !next.sessionId)
            throw new Error('Restarted native actor did not attest.');
          if (measure) await measure.publish({generation, sessionPath: actorSession, taskName: taskName()});
          normalClosed = false;
          answer = { ...(message.graceful === true ? {lifecycle:'normal-close-reopen'} : {}), type: 'restart', round: message.round ?? 0, generation, beforeSessionId: attestation.sessionId, afterSessionId: next.sessionId, attestation: next };
          attestation = next;
        } else {
          answer = await request(++actorSeq, line, message.type);
          if (message.type === 'close-probe') normalClosed = answer?.type === 'close-probe' && answer.closed === true && answer.keepEditingDialog === false && answer.flushed === true;
          if (message.type === 'hello') {
            if (measure && answer?.type === 'attest') await measure.publish({generation, sessionPath: actorSession, taskName: taskName()});
            helloLine = line; attestation = answer;
          }
        }
      }
      catch (error) {
        const detail = error instanceof Error && error.message.startsWith('Native actor') ? error.message : 'Native actor did not reply within the bound.';
        fail(detail, message.round ?? 0); failed = true; break;
      }
      if (message.type === 'shutdown') { stopped = true; if (answer?.ok !== true) failed = true; break; }
      process.stdout.write(JSON.stringify(answer) + '\n');
      if (answer?.type === 'error') failed = true;
    }
    if (!stopped) {
      try { const ack = await request(++actorSeq, JSON.stringify({ type: 'shutdown' }), 'shutdown'); if (ack?.ok !== true) failed = true; }
      catch { failed = true; }
    }
    await finishTask();
    return failed ? 1 : 0;
  } catch (error) {
    process.stderr.write(String(error?.message ?? error) + '\n');
    return 1;
  }
}
const directPath = path => process.platform === 'win32' ? path.toLowerCase() : path;
if (process.argv[1] && directPath(resolve(process.argv[1])) === directPath(fileURLToPath(import.meta.url))) main().then(code => process.exit(code)).catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exit(1); });
