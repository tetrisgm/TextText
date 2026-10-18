import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localBuildEnvironment } from './with-local-database.mjs';
const local = 'postgresql://fixture@127.0.0.1:5432/fixture';
const foreign = 'postgresql://fixture@remote.invalid/fixture';
function fixture(bytes) { const root = mkdtempSync(join(tmpdir(), 'texttext-local-env-')); if (bytes !== undefined) writeFileSync(join(root, '.env.local'), bytes); return root; }
test('default local file still overrides inherited remote connection', () => {
  const result = localBuildEnvironment(fixture('DATABASE_URL=' + local + '\n'), { DATABASE_URL: foreign });
  assert.equal(result.DATABASE_URL, local);
});
test('empty archive selects inherited loopback only with explicit opt-in', () => {
  const root = fixture('');
  assert.throws(() => localBuildEnvironment(root, { DATABASE_URL: local }), /local Postgres/);
  assert.equal(localBuildEnvironment(root, { DATABASE_URL: local, TEXTTEXT_LOCAL_DATABASE_INHERITED: '1' }).DATABASE_URL, local);
  assert.throws(() => localBuildEnvironment(root, { DATABASE_URL: foreign, TEXTTEXT_LOCAL_DATABASE_INHERITED: '1' }), /local Postgres/);
  assert.throws(() => localBuildEnvironment(root, { TEXTTEXT_LOCAL_DATABASE_INHERITED: '1' }), /local Postgres/);
});
test('nonempty environment retains file precedence even when archive opt-in is set', () => {
  assert.equal(localBuildEnvironment(fixture('DATABASE_URL=' + local), { DATABASE_URL: foreign, TEXTTEXT_LOCAL_DATABASE_INHERITED: '1' }).DATABASE_URL, local);
  assert.throws(() => localBuildEnvironment(fixture('DATABASE_URL=' + foreign), { DATABASE_URL: local, TEXTTEXT_LOCAL_DATABASE_INHERITED: '1' }), /local Postgres/);
  assert.throws(() => localBuildEnvironment(fixture('# no connection\n'), { DATABASE_URL: local, TEXTTEXT_LOCAL_DATABASE_INHERITED: '1' }), /local Postgres/);
});
test('archive opt-in refuses missing, linked and non-file environments', () => {
  const environment = { DATABASE_URL: local, TEXTTEXT_LOCAL_DATABASE_INHERITED: '1' };
  assert.throws(() => localBuildEnvironment(fixture(), environment));
  const directory = fixture(); mkdirSync(join(directory, '.env.local'));
  assert.throws(() => localBuildEnvironment(directory, environment), /regular local file/);
  if (process.platform !== 'win32') {
    const root = fixture(), target = join(root, 'kept-empty'); writeFileSync(target, ''); symlinkSync(target, join(root, '.env.local'));
    assert.throws(() => localBuildEnvironment(root, environment), /regular local file/);
  }
});
