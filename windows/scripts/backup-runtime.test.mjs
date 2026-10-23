import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsArgs } from '../../release/ship-all.mjs';

test('runtime override is a literal argument inside encoded Windows command', () => {
  const runtime = "C:\\Program Files\\Owner's Tools\\pwsh.exe";
  const args = windowsArgs('Preflight', 'a'.repeat(40), 'fixture', runtime);
  const command = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.ok(command.endsWith(" -PowerShell7Path 'C:\\Program Files\\Owner''s Tools\\pwsh.exe'"));
  assert.equal(args.at(-2), '-EncodedCommand');
  assert.throws(() => windowsArgs('Preflight', 'a'.repeat(40), 'fixture', '../pwsh'), /absolute Windows path/);
});
