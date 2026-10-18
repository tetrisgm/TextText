import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withPreservedPackageResolution } from './build-private-actor.mjs';

for (const fails of [false, true]) test(`private actor restores exact package resolution after Swift ${fails ? 'failure' : 'success'}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'texttext-actor-resolution-'));
  try {
    mkdirSync(join(root, 'mac'));
    const path = join(root, 'mac/Package.resolved');
    const original = Buffer.from('{"pins":["Sparkle"]}\r\n');
    writeFileSync(path, original);
    const action = () => {
      writeFileSync(path, '{"pins":[]}\n');
      if (fails) throw Error('Swift build failed');
      return 'private-bin-path';
    };
    if (fails) assert.throws(() => withPreservedPackageResolution(root, action), /Swift build failed/);
    else assert.equal(withPreservedPackageResolution(root, action), 'private-bin-path');
    assert.deepEqual(readFileSync(path), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
