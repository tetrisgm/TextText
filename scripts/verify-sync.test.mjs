import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const failProducer of [false, true]) {
  test(`sync gate produces policy before local database verification (producer failure=${failProducer})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'texttext-sync-entry-test-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'bin'));
    copyFileSync(new URL('./verify-sync.sh', import.meta.url), join(root, 'scripts/verify-sync.sh'));
    writeFileSync(join(root, 'bin/node'), `#!/bin/bash
set -eu
test -d "$TEXTTEXT_MIRROR_POLICY_BUNDLE"
printf '%s|%s\\n' "$*" "$TEXTTEXT_MIRROR_POLICY_BUNDLE" >> "$TEST_LOG"
if [[ "$1" == src/local-vault/__tests__/mirror-policy.browser.mjs ]]; then
  exit ${failProducer ? 23 : 0}
fi
test "$1" = scripts/with-local-database.mjs
test "$2" = node
test "$3" = sync/verify.mjs
`, { mode: 0o755 });
    const log = join(root, 'calls');
    const result = spawnSync('bash', ['scripts/verify-sync.sh'], {
      cwd: root, env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, TEST_LOG: log }, encoding: 'utf8',
    });
    assert.equal(result.status, failProducer ? 23 : 0, result.stderr);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => line.split('|'));
    assert.equal(calls.length, failProducer ? 1 : 2);
    assert.equal(calls[0][0], 'src/local-vault/__tests__/mirror-policy.browser.mjs');
    if (!failProducer) {
      assert.equal(calls[1][0], 'scripts/with-local-database.mjs node sync/verify.mjs');
      assert.equal(calls[0][1], calls[1][1]);
    }
  });
}
