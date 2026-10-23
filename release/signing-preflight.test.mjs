import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectSigningIdentity, signingPreflight } from './signing-preflight.mjs';

const hash = 'A'.repeat(40);
const listing = `  1) ${hash} "Apple Development: Existing"\n  2) ${'B'.repeat(40)} "Apple Development: Other"`;
function fixture() {
  const evidence = mkdtempSync(join(tmpdir(), 'texttext-signing-test-'));
  const source = join(evidence, 'fixture');
  writeFileSync(source, 'benign fake binary');
  return { evidence, source };
}
test('selects first local-development identity and resolves explicit identity to its exact hash', () => {
  assert.equal(selectSigningIdentity(listing), hash);
  assert.equal(selectSigningIdentity(listing, 'Apple Development: Other'), 'B'.repeat(40));
  assert.equal(selectSigningIdentity(listing, hash.toLowerCase()), hash);
  assert.throws(() => selectSigningIdentity(listing, '-'), /missing or ambiguous/);
  assert.throws(() => selectSigningIdentity(`${listing}\n 3) ${'C'.repeat(40)} "Apple Development: Existing"`, 'Apple Development: Existing'), /ambiguous/);
});
test('signs and verifies a retained copy with exact identity, without executing it', () => {
  const { evidence, source } = fixture();
  const calls = [];
  assert.equal(signingPreflight(evidence, '', (command, args) => { calls.push([command, args]); return command === 'security' ? listing : ''; }, source), hash);
  const probe = join(evidence, 'signing-preflight', 'true');
  assert.deepEqual(calls.slice(1), [['codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', hash, probe]], ['codesign', ['--verify', '--strict', probe]]]);
  assert.equal(readFileSync(probe, 'utf8'), 'benign fake binary');
  assert.equal(readFileSync(source, 'utf8'), 'benign fake binary');
});
test('private-key refusal aborts before later gates and retains failure evidence', () => {
  const { evidence, source } = fixture();
  let laterGate = false;
  assert.throws(() => {
    signingPreflight(evidence, '', command => {
      if (command === 'security') return listing;
      throw Object.assign(new Error('sign failed'), { stderr: 'errSecInternalComponent: private key unavailable' });
    }, source);
    laterGate = true;
  }, /private key unavailable/);
  assert.equal(laterGate, false);
  assert.equal(readFileSync(join(evidence, 'signing-preflight', 'true'), 'utf8'), 'benign fake binary');
});
test('verification failure fails closed and existing probe directory is never reused', () => {
  const { evidence, source } = fixture();
  const execute = (command, args) => {
    if (command === 'security') return listing;
    if (args[0] === '--verify') throw new Error('invalid signature');
    return '';
  };
  assert.throws(() => signingPreflight(evidence, '', execute, source), /invalid signature/);
  assert.throws(() => signingPreflight(evidence, '', execute, source), /EEXIST/);
});
