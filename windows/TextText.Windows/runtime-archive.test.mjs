import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeArchiveEntries } from './runtime-archive.mjs';
for (const newline of ['\n', '\r\n']) {
  test(`native executable is found with ${JSON.stringify(newline)} tar output`, () => {
    const names = runtimeArchiveEntries(['package/vendor/bin/codex.exe', 'package/vendor/bin/helper.exe', ''].join(newline));
    assert.equal(names.find(name => /\/bin\/codex\.exe$/.test(name)), 'package/vendor/bin/codex.exe');
    assert.deepEqual(names, ['package/vendor/bin/codex.exe', 'package/vendor/bin/helper.exe']);
  });
}
test('unsafe archive paths remain rejected with Windows line endings', () => {
  for (const path of ['/outside', '../outside', 'package/../outside', 'C:/outside', 'package\\outside']) {
    assert.throws(() => runtimeArchiveEntries(`${path}\r\n`), /Invalid package paths/);
  }
  assert.deepEqual(runtimeArchiveEntries('package/name with spaces\r\n'), ['package/name with spaces']);
});
