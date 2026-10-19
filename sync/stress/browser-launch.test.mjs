import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserLaunchArguments, edgeDisabledFeatures, playwrightBundlePath } from './browser-launch.mjs';

const fixture = names => 'disabledFeatures = [\n' + names.map(name => `  "${name}",`).join('\n') + '\n].filter(Boolean);';
test('Edge keeps every locked Playwright default and adds the account-lockout mitigation once', () => {
  const defaults = ['One', 'Two'];
  assert.deepEqual(browserLaunchArguments('win32', () => fixture(defaults)), ['--enable-automation', '--disable-features=One,Two,AutofillAiWalletPrivatePasses']);
  assert.equal(edgeDisabledFeatures(fixture(['One', 'AutofillAiWalletPrivatePasses'])), '--disable-features=One,AutofillAiWalletPrivatePasses');
  assert.deepEqual(browserLaunchArguments('darwin', () => { throw Error('Must not read Edge defaults'); }), ['--enable-automation']);
});
test('unknown, ambiguous, executable or excessive defaults refuse before any browser launch', () => {
  for (const source of ['', fixture([]), fixture(['One']) + '\n' + fixture(['Two']), 'disabledFeatures = [\nprocess.env.SECRET\n].filter(Boolean);', fixture(['One', 'One']), fixture(Array.from({ length: 129 }, (_, i) => 'F' + i)), 'x'.repeat(8 * 1024 * 1024 + 1)]) {
    assert.throws(() => edgeDisabledFeatures(source), /Browser/);
  }
});
test('the installed locked SDK has one understood default feature list', () => {
  const args = edgeDisabledFeatures(readFileSync(playwrightBundlePath, 'utf8')).split('=')[1].split(',');
  for (const feature of ['AvoidUnnecessaryBeforeUnloadCheckSync', 'msForceBrowserSignIn', 'AutofillAiWalletPrivatePasses']) assert.ok(args.includes(feature));
  assert.equal(args.length, new Set(args).size);
});
test('both standalone Edge entry points use the shared mitigation', () => {
  for (const name of ['./browser-adapter.mjs', '../../windows/scripts/live-browser-acceptance.mjs']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.match(source, /args: browserLaunchArguments\(process\.platform\)/);
  }
});
