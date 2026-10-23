import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function assertReleaseSource(root, commit) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain', '--untracked-files=no')) {
    throw new Error('Source changed during combined release; refusing the next surface.');
  }
}

export async function withCommittedPin(root, evidence, action) {
  const git = (...args) => execFileSync('git', args, { cwd: root });
  const dirty = git('diff', 'HEAD', '--name-only').toString().trim().split('\n').filter(Boolean);
  if (dirty.some(name => name !== 'mac/Package.resolved') || git('diff', '--cached', '--name-only').length) {
    throw new Error('Release requires a clean commit; only an unstaged mac/Package.resolved is preserved automatically.');
  }
  const path = join(root, 'mac/Package.resolved');
  const original = readFileSync(path);
  const committed = git('show', 'HEAD:mac/Package.resolved');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'owner-Package.resolved'), original, { flag: 'wx', mode: 0o600 });
  writeFileSync(path, committed);
  try { return await action(); }
  finally {
    if (!readFileSync(path).equals(committed)) {
      throw new Error(`Package.resolved changed during release; preserved owner copy at ${evidence}. Refusing to overwrite the unexpected edit.`);
    }
    writeFileSync(path, original);
  }
}
