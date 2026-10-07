import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

it.runIf(process.platform === 'darwin').each(['build-app.sh', 'build-store.sh'])('%s stops before building/signing when sync verification fails', script => {
  const bin = mkdtempSync(path.join(tmpdir(), 'texttext-failed-sync-gate-'));
  try {
    writeFileSync(path.join(bin, 'node'), '#!/bin/sh\necho SYNC_GATE_REJECTED >&2\nexit 77\n', { mode: 0o755 });
    const result = spawnSync('bash', [`mac/scripts/${script}`], { encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEXTTEXT_STORE: '0' } });
    expect(result.status).toBe(77);
    expect(result.stderr).toContain('SYNC_GATE_REJECTED');
    expect(result.stdout).not.toContain('>> build');
  } finally { rmSync(bin, { recursive: true, force: true }); }
});
