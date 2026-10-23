import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireBackupSpace } from './storage-preflight.mjs';

test('deployment requires the whole backup budget plus the free-space floor', () => {
  const required = 7n * 1024n ** 3n;
  assert.throws(() => requireBackupSpace({}, required - 1n), /Deploy refused before build\/transfer/);
  assert.equal(requireBackupSpace({}, required), required);
  assert.equal(requireBackupSpace({ TEXTTEXT_BACKUP_MAX_BYTES: '2048', TEXTTEXT_STORAGE_MIN_FREE_BYTES: '512' }, 2560n), 2560n);
});
test('invalid configured budgets fail closed', () => {
  for (const value of ['NaN', '-1', '1.5', '9007199254740992']) {
    assert.throws(() => requireBackupSpace({ TEXTTEXT_BACKUP_MAX_BYTES: value }, 10n ** 20n), /Invalid/);
    assert.throws(() => requireBackupSpace({ TEXTTEXT_STORAGE_MIN_FREE_BYTES: value }, 10n ** 20n), /Invalid/);
  }
});
