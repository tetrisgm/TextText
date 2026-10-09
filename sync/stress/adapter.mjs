// Child-process JSONL adapter: one process per role, newline-delimited JSON on stdin/stdout.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { EventEmitter } from 'node:events';

const MAX_LINE = 256 * 1024;
const MAX_STDERR = 64 * 1024;
// Quotes are excluded from the value so redaction keeps JSON lines parseable.
const SECRET = /\b(token|secret|password|passwd|cookie|authorization|api[_-]?key|bearer)\b(\s*[:=]\s*|\s+)(bearer\s+)?[^\s"']+/gi;

export const redact = (text) => String(text).replace(SECRET, (_, k) => `${k}=[redacted]`);

export class ProcessAdapter extends EventEmitter {
  constructor(role, command, { cwd, env = {}, log } = {}) {
    super();
    if (!Array.isArray(command) || command.length === 0 || command.some((c) => typeof c !== 'string')) {
      throw new Error(`role ${role}: command must be a non-empty string array`);
    }
    this.role = role;
    this.command = command;
    this.cwd = cwd;
    this.env = env;
    this.log = log ?? (() => {});
    this.stderr = '';
    this.exit = null;
    this.child = null;
  }

  start() {
    const [file, ...args] = this.command;
    // Explicit environment only: PATH plus the configured allowlist. Host secrets never reach adapters.
    const env = { PATH: process.env.PATH, ...this.env };
    this.child = spawn(file, args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exitPromise = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => { this.exit = { code, signal }; resolve(this.exit); this.emit('exit', this.exit); });
      this.child.once('error', () => { this.exit = { code: -1, signal: null }; resolve(this.exit); this.emit('exit', this.exit); });
    });
    this.child.once('error', (error) => this.emit('error', error));
    this.child.stderr.on('data', (chunk) => {
      if (this.stderr.length < MAX_STDERR) this.stderr += redact(chunk.toString()).slice(0, MAX_STDERR - this.stderr.length);
    });
    const decode = new StringDecoder('utf8');
    let pending = '', rejected = false, total = 0;
    this.child.stdout.on('data', chunk => {
      if (rejected) return;
      total += chunk.length;
      if (total > 64 * 1024 * 1024) { rejected = true; pending = ''; this.emit('error', new Error('Adapter output budget exceeded')); return; }
      pending += decode.write(chunk);
      while (pending.includes('\n')) {
        const end = pending.indexOf('\n');
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        receive(line);
      }
      if (pending.length > MAX_LINE) {
        pending = ''; rejected = true;
        this.emit('error', new Error('Adapter output exceeded line bound'));
      }
    });
    const receive = line => {
      if (line.length > MAX_LINE) return this.emit('reject', { role: this.role, reason: 'line-too-long', bytes: line.length });
      let message;
      try { message = JSON.parse(line); } catch { return this.emit('reject', { role: this.role, reason: 'invalid-json', line: redact(line.slice(0, 200)) }); }
      if (!message || typeof message.type !== 'string') return this.emit('reject', { role: this.role, reason: 'missing-type' });
      this.emit('message', message);
    };
    this.child.stdin.on('error', error => this.emit('error', error));
    return this;
  }

  send(message) {
    if (!this.child || this.exit || !this.child.stdin.writable) return false;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  // Clean stop: shutdown message, then SIGTERM, then SIGKILL, each bounded.
  async stop(graceMs = 2000) {
    if (!this.child || this.exit) return this.exit;
    this.send({ type: 'shutdown' });
    try { this.child.stdin.end(); } catch { /* already closed */ }
    const wait = async ms => {
      let timer;
      try { return await Promise.race([this.exitPromise, new Promise(r => { timer = setTimeout(() => r(null), ms); })]); }
      finally { clearTimeout(timer); }
    };
    if (await wait(graceMs)) return this.exit;
    this.child.kill('SIGTERM');
    if (await wait(graceMs)) return this.exit;
    this.child.kill('SIGKILL');
    return await wait(graceMs) ?? { code: null, signal: 'shutdown-timeout' };
  }
}
