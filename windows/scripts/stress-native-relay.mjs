#!/usr/bin/env node
// Windows SSH JSONL relay for the real interactive WPF/WebView2 stress actor.
// Node owns streaming stdin because PowerShell's SSH Console.In stalls after the
// first line on this host. PowerShell is used only for one-shot task lifecycle.
import { readFileSync, mkdirSync, existsSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join, basename, extname } from 'node:path';

const [assembly, configPath, session] = process.argv.slice(2);
const script = new URL('./stress-native-task.ps1', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:\/)/, '');
const taskName = 'TextText-stress-native-' + randomUUID().replaceAll('-', '');
const fail = (message, round = 0) => process.stdout.write(JSON.stringify({ type: 'error', round, message }) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function task(finish = false) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Assembly', assembly, '-Config', configPath, '-Session', session, '-TaskName', taskName];
  if (finish) args.push('-Finish');
  const result = spawnSync('powershell.exe', args, { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(finish ? 'Native actor did not flush or exit cleanly.' : 'Native actor could not start.');
}
async function reply(seq, limitMs) {
  const file = join(session, `rep-${String(seq).padStart(6, '0')}.json`);
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
  const file = join(session, `req-${String(seq).padStart(6, '0')}.json`);
  const tmp = file + '.tmp';
  writeFileSync(tmp, line, { flag: 'wx' });
  renameSync(tmp, file);
  return reply(seq, type === 'hello' ? 120000 : 100000);
}
async function main() {
  if (![assembly, configPath, session].every(p => typeof p === 'string' && isAbsolute(p))) throw new Error('Absolute test paths are required.');
  if (!existsSync(assembly) || !existsSync(configPath) || existsSync(session)) throw new Error('Test input is missing or the session already exists.');
  if (statSync(configPath).size > 16384) throw new Error('Test config exceeds the bound.');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const title = config.Title ?? config.title;
  const file = config.File ?? config.file;
  if (!title?.startsWith('Six-client acceptance ') || basename(file ?? '', extname(file ?? '')) !== title) throw new Error('Not a dedicated acceptance file.');
  mkdirSync(session);
  task(false);
  let seq = 0, stopped = false, failed = false;
  try {
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      if (line.length > 256 * 1024) { fail('Request exceeds the message bound.'); failed = true; break; }
      let message;
      try { message = JSON.parse(line); } catch { fail('Request is not valid JSON.'); failed = true; break; }
      seq++;
      let answer;
      try { answer = await request(seq, line, message.type); }
      catch { fail('Native actor did not reply within the bound.', message.round ?? 0); failed = true; break; }
      if (message.type === 'shutdown') { stopped = true; if (answer?.ok !== true) failed = true; break; }
      process.stdout.write(JSON.stringify(answer) + '\n');
      if (answer?.type === 'error') failed = true;
    }
    if (!stopped) {
      seq++;
      try { const ack = await request(seq, JSON.stringify({ type: 'shutdown' }), 'shutdown'); if (ack?.ok !== true) failed = true; }
      catch { failed = true; }
    }
    for (let i = 0; i < 300; i++) {
      try { task(true); return failed ? 1 : 0; } catch { await pause(100); }
    }
    throw new Error('Native actor remained open after shutdown.');
  } catch (error) {
    process.stderr.write(String(error?.message ?? error) + '\n');
    return 1;
  }
}
main().then(code => process.exit(code)).catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exit(1); });
