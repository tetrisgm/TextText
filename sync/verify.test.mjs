import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coreDatabaseEnvironment, inputs, fingerprint, validateReceipt, recordPassingRun, stressTestPaths } from './verify.mjs';

test('manual verification discovers every runner regression including new protocol helpers', async () => {
  const actual = await stressTestPaths();
  for (const name of ['build-private-actor', 'identity', 'native-close-lifecycle', 'malformed-repair', 'undo-redo', 'file-adapter', 'browser-adapter', 'asset-proof', 'asset-pack-proof', 'asset-proof-observation', 'asset-proof-wave', 'measurement-host-pc', 'measurement-authority-pc', 'measurement-supervisor']) {
    assert.ok(actual.includes(`sync/stress/${name}.test.mjs`));
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-stress-discovery-'));
  try {
    await fs.mkdir(path.join(temporary, 'sync/stress'), { recursive: true });
    await assert.rejects(stressTestPaths(temporary), /suite is missing/);
    await fs.writeFile(path.join(temporary, 'sync/stress/new-protocol.test.mjs'), '');
    await fs.writeFile(path.join(temporary, 'sync/stress/README.md'), '');
    assert.deepEqual(await stressTestPaths(temporary), ['sync/stress/new-protocol.test.mjs']);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('invocation through a symlink executes the gate and rejects invalid flags', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-sync-entry-'));
  try {
    const linkedDirectory = path.join(root, 'sync');
    await fs.symlink(fileURLToPath(new URL('.', import.meta.url)), linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir');
    const entry = path.join(linkedDirectory, 'verify.mjs');
    const result = spawnSync(process.execPath, [entry, '--invalid-gate-option'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unknown flag --invalid-gate-option/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('source additions, changes and removals invalidate receipts; prose does not', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-sync-gate-'));
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'original');
    const first = await fingerprint(root, ['src']);
    await fs.writeFile(path.join(root, 'src', 'readme.md'), 'notes');
    assert.equal(await fingerprint(root, ['src']), first);
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'changed');
    const changed = await fingerprint(root, ['src']);
    assert.notEqual(changed, first);
    await fs.writeFile(path.join(root, 'src', 'b.ts'), 'new');
    assert.notEqual(await fingerprint(root, ['src']), changed);
    await fs.rm(path.join(root, 'src', 'a.ts'));
    assert.notEqual(await fingerprint(root, ['src']), first);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('missing, failed, stale and wrong-platform or scope receipts fail closed', () => {
  const passed = { schema: 1, status: 'passed', digest: 'source', platform: 'darwin', scope: 'core', node: process.versions.node };
  validateReceipt(passed, 'source', 'darwin', 'core');
  for (const receipt of [undefined, {}, { ...passed, status: 'failed' }, { ...passed, digest: 'old' },
    { ...passed, platform: 'win32' }, { ...passed, scope: 'native' }, { ...passed, node: 'old' }]) {
    assert.throws(() => validateReceipt(receipt, 'source', 'darwin', 'core'), /verification/);
  }
});

test('Windows sync sources and regressions invalidate receipts, generated .NET output does not', async () => {
  assert.ok(inputs.includes('windows/TextText.Core'));
  assert.ok(inputs.includes('windows/TextText.Core.Tests'));
  assert.ok(inputs.includes('windows/TextText.Windows'));
  assert.ok(inputs.includes('windows/TextText.Windows.Tests'));
  assert.ok(inputs.includes('windows/TextText.LiveAcceptance.Tests'));
  assert.ok(inputs.includes('windows/scripts/build.ps1'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-windows-gate-'));
  const paths = ['windows/TextText.Core', 'windows/TextText.Core.Tests', 'windows/TextText.Windows', 'windows/TextText.Windows.Tests', 'windows/TextText.LiveAcceptance.Tests'];
  try {
    for (const directory of paths) {
      await fs.mkdir(path.join(root,directory),{recursive:true});
      await fs.writeFile(path.join(root,directory,'Source.cs'),'original');
    }
    const before = await fingerprint(root,paths);
    for (const generated of ['bin','obj']) {
      await fs.mkdir(path.join(root,paths[0],generated));
      await fs.writeFile(path.join(root,paths[0],generated,'output'),'generated');
    }
    await fs.mkdir(path.join(root,paths[2],'Runtime'));
    await fs.writeFile(path.join(root,paths[2],'Runtime','codex.exe'),'downloaded runtime');
    assert.equal(await fingerprint(root,paths),before);
    await fs.writeFile(path.join(root,paths[0],'Source.cs'),'changed sync');
    const changed = await fingerprint(root,paths); assert.notEqual(changed,before);
    await fs.writeFile(path.join(root,paths[1],'Source.cs'),'changed regression');
    assert.notEqual(await fingerprint(root,paths),changed);
    const beforeBridge = await fingerprint(root,paths);
    await fs.writeFile(path.join(root,paths[2],'Source.cs'),'changed native HTTP bridge');
    assert.notEqual(await fingerprint(root,paths),beforeBridge);
    const beforeBridgeTests = await fingerprint(root,paths);
    await fs.writeFile(path.join(root,paths[3],'Source.cs'),'changed bridge regression');
    assert.notEqual(await fingerprint(root,paths),beforeBridgeTests);
    const beforeActorTests = await fingerprint(root,paths);
    await fs.writeFile(path.join(root,paths[4],'Source.cs'),'changed private actor read-proof regression');
    assert.notEqual(await fingerprint(root,paths),beforeActorTests);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('normal Windows and manual native gates require private actor proofs without launching acceptance', async () => {
  const project = 'windows/TextText.LiveAcceptance.Tests/TextText.LiveAcceptance.Tests.csproj';
  const build = await fs.readFile(new URL('../windows/scripts/build.ps1', import.meta.url), 'utf8');
  const manual = await fs.readFile(new URL('../scripts/test-sync.sh', import.meta.url), 'utf8');
  assert.ok(build.includes(`& $dotnet run --project ${project} --configuration Release\n  if ($LASTEXITCODE -ne 0)`));
  assert.ok(manual.includes(`dotnet run --project ${project}`));
  assert.ok(manual.includes('Required private Windows actor read-proof checks did not execute.'));
  assert.match(manual, /^node --test .*windows\/scripts\/measurement-launch-owner\.test\.mjs/m);
  assert.ok(build.includes('& powershell -NoProfile -ExecutionPolicy Bypass -File windows/scripts/smoke.ps1'));
  assert.ok(!build.includes('run --project windows/TextText.LiveAcceptance/TextText.LiveAcceptance.csproj'));
  assert.ok(!manual.includes('run --project windows/TextText.LiveAcceptance/TextText.LiveAcceptance.csproj'));
});

test('manual native gate selects and requires handoff and retained-work suites', async () => {
  const manual = await fs.readFile(new URL('../scripts/test-sync.sh', import.meta.url), 'utf8');
  const filter = manual.match(/--filter '([^']+)'/);
  assert.ok(filter, 'explicit native filter is required');
  const required = [...manual.matchAll(/for suite in ([^;\n]+); do/g)]
    .flatMap(match => match[1].trim().split(/\s+/));
  for (const suite of ['LocalHandoffProfile', 'LocalHandoffBridge', 'MirrorTombstoneIntegration',
    'SharedRenameProfile', 'ProtectedRenameTransport', 'MissingManifestVisibility', 'QueuedUploadPathAdoption',
    'LocalVaultFileMutationHandoff', 'LocalVaultFileMutationWake', 'LocalVaultGeneration', 'LocalVaultAbsentRename', 'ObservedAbsenceProfile']) {
    assert.ok(filter[1].split('|').includes(`${suite}Tests`), `${suite} is selected`);
    assert.ok(required.includes(suite), `${suite} must execute`);
  }
  assert.ok(manual.includes('Required native creation suite did not execute: ${suite}Tests'));
  for (const method of ['testImageCASReopenBeforeMirrorACKRetainsBytesAndOneMirrorPassResolves',
    'testSuccessfulBridgeWriteWakesAfterReleasePassFinishedBeforeCAS', 'testFailedCASDoesNotWakeAnotherPass',
    'testChangedOwnerDoesNotWakeCapturedConnection', 'testStoppedConnectionDoesNotWakeAfterWrite',
    'testChangedRootDoesNotWakeCapturedConnection']) assert.ok(manual.includes(method));
  assert.ok(manual.includes('Required file mutation handoff cases must not skip.'));
  assert.ok(manual.includes('testFreshGenerationEvidenceFromActualDirectoryManifest'));
  assert.ok(manual.includes('Required generation and absent rename cases must not skip.'));
  for (const method of ['testSixPreservesExactFiveAndNeverDowngrades', 'testInterruptedSixPublicationRetainsFiveAndPendingBytes', 'testForeignFiveBackupCannotBeOverwritten']) assert.ok(manual.includes(method));
  assert.ok(manual.includes('Required observed absence profile cases must not skip.'));
  for (const method of ['testDuplicateProfileAuthorityFilesRefuseWithoutRepair', 'testGenerationEvidenceRejectsCredentialRotationDuringBodyRead', 'testRepeatedSameCredentialDoesNotInvalidateHeldGenerationEvidence', 'testCompleteDiscoveryRejectsTruncatedInventoryCount', 'testReadonlyProducerAttestsSixAndRefusesFutureProfileWithoutWrites']) assert.ok(manual.includes(method));
  for (const method of ['testAbsentNamingUnknownItemEntryRemainsByteExact', 'testAbsentNamingOrphanBinaryStageRemainsByteExact', 'testAbsentNamingIgnoresStaleIdentityCacheForProtection']) assert.ok(manual.includes(method));
  for (const method of ['testAbsentNamingDoesNotRepairMismatchedCheckpointPath', 'testAbsentNamingRetainedIntentAndRegistryRemainByteExact', 'testSamePathIdleDoesNotFetchGenerationEvidenceOrFullPack', 'testHeldAbsentItemDoesNotDisableUnrelatedPresentRecovery']) assert.ok(manual.includes(method));
  for (const method of ['testTypedGenerationSavedRenameVectorsRoundTripThroughSharedOwner', 'testLegacyNilWithoutFreshEvidenceRetainsLocalMove', 'testFreshAbsenceMovesWithoutInventingLifecycleOrContentAcknowledgement', 'testLostReplyRetainsExactVersionTwoRequest', 'testRestoreDuringEvidenceAwaitCannotDispatchAbsenceMove', 'testStoppedAbsentNamesPermitIndependentAssetCASWhilePendingTextIsRetained']) assert.ok(manual.includes(method));
  assert.ok(manual.includes('windows/scripts/browser-task-lifetime.test.mjs'));
});

test('default source fingerprint includes binary presets and their generation logic', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-preset-gate-'));
  try {
    for (const input of inputs) {
      await fs.mkdir(path.dirname(path.join(root, input)), {recursive:true});
      if (input === 'presets/builtin') await fs.mkdir(path.join(root,input), {recursive:true});
      else await fs.writeFile(path.join(root,input), 'fixture');
    }
    const preset = path.join(root,'presets/builtin/note.textpack');
    await fs.writeFile(preset, new Uint8Array([80,75,1]));
    const before = await fingerprint(root);
    await fs.writeFile(preset, new Uint8Array([80,75,2]));
    const changed = await fingerprint(root);
    assert.notEqual(changed,before);
    await fs.writeFile(path.join(root,'scripts/generate-builtin-presets.ts'),'changed generator');
    assert.notEqual(await fingerprint(root),changed);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});


test('core database regressions cannot silently skip or use a remote database', () => {
  for (const DATABASE_URL of [undefined, '', 'invalid', 'postgres://user:secret@production.example/db']) {
    assert.throws(() => coreDatabaseEnvironment({DATABASE_URL}), /requires local PostgreSQL/);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const DATABASE_URL = `postgres://user:secret@${host}/test`;
    assert.equal(coreDatabaseEnvironment({DATABASE_URL,TEXTTEXT_READING_DB_TEST:'0'}).TEXTTEXT_READING_DB_TEST, '1');
  }
});

test('failed reruns and edits during a run cannot leave a passing receipt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-sync-receipt-'));
  const file = path.join(root, 'receipt.json');
  try {
    await fs.writeFile(file, 'old passed receipt');
    await assert.rejects(recordPassingRun(file, 'old', 'darwin', 'core', async () => {
      throw new Error('regression');
    }, async () => 'old'), /regression/);
    await assert.rejects(fs.readFile(file), { code: 'ENOENT' });
    await assert.rejects(recordPassingRun(file, 'old', 'darwin', 'core', async () => {}, async () => 'changed'), /Source changed/);
    await assert.rejects(fs.readFile(file), { code: 'ENOENT' });
    await recordPassingRun(file, 'same', 'darwin', 'core', async () => {}, async () => 'same');
    validateReceipt(JSON.parse(await fs.readFile(file, 'utf8')), 'same', 'darwin', 'core');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('core gate requires title promotion caret, backward selection, and nonstealing variants', async () => {
  const verifier = await fs.readFile(new URL('./verify.mjs', import.meta.url), 'utf8');
  assert.ok(verifier.includes("for (const mode of [[], ['--backward-selection'], ['--focus-elsewhere']])"));
  assert.ok(verifier.includes("['--import', 'tsx', 'src/local-vault/__tests__/verify-new-note-title-promotion.mts', ...mode]"));
});

test('native handoff gates include exact replay, controls, web boundary, and pure ownership contracts', async () => {
  const verifier = await fs.readFile(new URL('./verify.mjs', import.meta.url), 'utf8');
  for (const name of ['verify-native-handoff-controls.mts', 'verify-native-handoff-restart.mts', 'verify-web-handoff-bootstrap.mts']) {
    assert.ok(verifier.includes(name), name);
  }
  for (const flag of ['--typing-during-promotion', '--typing-during-baseline', '--typing-during-checkpoint', '--continuous', '--ime', '--capture', '--reader', '--drain', '--certified-once', '--certified-retry', '--unknown-open', '--retry-account-change', '--unverified-open', '--certified-startup']) {
    assert.ok(verifier.includes(flag), flag);
  }
  for (const config of ['vitest.config.mts', 'vitest.client.config.mts']) {
    const source = await fs.readFile(new URL(config, import.meta.url), 'utf8');
    for (const contract of ['local-shared-handoff', 'native-handoff-draft', 'handoff-update', 'editor-surface-host', 'shared-open']) {
      assert.ok(source.includes(contract), `${config}: ${contract}`);
    }
  }
});


test('official core gate registers the custom gallery title fixture and fingerprints its source', async () => {
  const verifier = await fs.readFile(new URL('./verify.mjs', import.meta.url), 'utf8');
  const shell = await fs.readFile(new URL('../scripts/test-sync.sh', import.meta.url), 'utf8');
  assert.ok(inputs.includes('src'), 'recursive source inventory includes the new editor fixture');
  assert.ok(shell.includes('exec node sync/verify.mjs "$@"'), 'normal test-sync invocation delegates to the registered core gate');
  assert.ok(verifier.includes("['--import', 'tsx', 'src/local-vault/__tests__/verify-custom-gallery-title.mts']"));
});


test('folder policy source, fixtures and native suites participate in official gates', async () => {
  const build = await fs.readFile(new URL('../scripts/build-local-vault.mjs', import.meta.url), 'utf8');
  const client = await fs.readFile(new URL('./vitest.client.config.mts', import.meta.url), 'utf8');
  const native = await fs.readFile(new URL('../scripts/test-sync.sh', import.meta.url), 'utf8');
  assert.ok(inputs.includes('src') && inputs.includes('sync') && inputs.includes('mac/Tests'));
  assert.ok(build.includes('src/sync/engine/mirror-folder.ts'));
  assert.ok(client.includes('src/sync/engine/mirror-folder.test.ts'));
  assert.ok(native.includes('FolderPolicyTests|'));
  assert.match(native, /for suite in [^;]*\bFolderPolicy\b/);
});

test('actual WebView2 smoke registers folder vectors in every existing policy phase', async () => {
  const helper = await fs.readFile(new URL('../windows/TextText.Smoke/MirrorAdditionalPolicyTests.cs', import.meta.url), 'utf8');
  const smoke = await fs.readFile(new URL('../windows/TextText.Smoke/MirrorPolicyTests.cs', import.meta.url), 'utf8');
  const fixture = await fs.readFile(new URL('../src/local-vault/__tests__/mirror-policy.browser.mjs', import.meta.url), 'utf8');
  const program = await fs.readFile(new URL('../windows/TextText.Smoke/Program.cs', import.meta.url), 'utf8');
  assert.ok(program.includes('GetEnvironmentVariable("TEXTTEXT_SMOKE_CASE") == "mirror-policy"'));
  assert.ok(program.includes('await MirrorPolicyTests.RunAsync(temp,timeout.Token)'));
  assert.ok(inputs.includes('windows/TextText.Smoke'));
  assert.ok(helper.includes('("folder","folder-vectors.json")'));
  assert.ok(helper.includes('policy.FolderAsync('));
  for (const phase of ['visible', 'hidden', 'production-factory']) assert.ok(smoke.includes(`fixture,"${phase}"`));
  assert.ok(smoke.includes('MirrorAdditionalPolicyTests.RefusalsAsync('));
  assert.ok(fixture.includes("copyFile('sync/fixtures/mirror-folder.json',path.join(output,'folder-vectors.json'))"));
});

test('readonly asset pack reader and proof sources/tests are recursive fingerprint inputs',async()=>{
  assert.ok(inputs.includes('sync'));
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'texttext-asset-inputs-'));
  const names=['pack-reader.mjs','asset-proof.mjs','asset-pack-proof.mjs','asset-proof-observation.mjs','asset-proof-observation.test.mjs','asset-proof-wave.mjs','asset-proof-wave.test.mjs'];
  try {
    await fs.mkdir(path.join(temporary,'sync/stress'),{recursive:true});
    for(const name of names) await fs.writeFile(path.join(temporary,'sync/stress',name),'original');
    const original=await fingerprint(temporary,['sync']);
    for(const name of names) {
      const target=path.join(temporary,'sync/stress',name);
      await fs.writeFile(target,'changed');
      assert.notEqual(await fingerprint(temporary,['sync']),original,name);
      await fs.writeFile(target,'original');
      assert.equal(await fingerprint(temporary,['sync']),original,name);
    }
  } finally {await fs.rm(temporary,{recursive:true,force:true});}
});


test('native and hosted file mutation handoff regressions are required and fingerprinted', async () => {
  const verifier = await fs.readFile(new URL('./verify.mjs', import.meta.url), 'utf8');
  assert.ok(inputs.includes('src') && inputs.includes('sync'));
  assert.ok(verifier.includes("['--import', 'tsx', 'src/local-vault/__tests__/verify-file-mutation-handoff.mts', ...mode]"));
  for (const flag of ['--hosted', '--template', '--write-failure', '--unknown-write', '--read-failure', '--held-ready', '--switch-at-read', '--unmount-at-read', '--recovery', '--copy-failure']) assert.ok(verifier.includes(flag), flag);
  for (const config of ['vitest.config.mts', 'vitest.client.config.mts']) {
    const source = await fs.readFile(new URL(config, import.meta.url), 'utf8');
    assert.ok(source.includes('file-mutation-handoff'), config);
  }
});


test('manual native gate requires genuine readonly asset fixture and all flag suites', async () => {
  const script = await fs.readFile(new URL('../scripts/test-sync.sh', import.meta.url), 'utf8');
  assert.ok(script.includes('node --import tsx sync/stress/build-native-asset-inspection-fixture.mts "$asset_fixture"'));
  assert.ok(script.includes('asset_fixture="$asset_fixture_root/schema"'));
  assert.ok(script.includes('TEXTTEXT_ASSET_INSPECTION_FIXTURE="$asset_fixture" TEXTTEXT_STORE=1 swift test'));
  assert.ok(script.includes('-Xswiftc -DTEXTTEXT_STRESS_ACTOR'));
  assert.ok(script.includes("--filter 'NativeStressAssetProofTests|LocalVaultStressObservationTests|ObservedAbsenceProfileTests'"));
  for (const method of ['testReadonlyProducerAttestsSixAndRefusesFutureProfileWithoutWrites', 'testStrictRequestBeforeReads', 'testActualBytesAssetsAndNoSchemaDuplication', 'testMalformedUTF8ArchiveNamesRefuseBeforeIdentity', 'testECMAScriptCanonicalRetainsAbsenceAndNumericSemantics', 'testReadonlyReadRefusesLinksAndPreservesBytes', 'testActualWKProductSchemaRejectsHiddenInvalidFields', 'testAbsentPrivateDirectoryStaysAbsent', 'testCompletedFolderHistoryAttestsAndPendingRefusesWithoutCreatingLease', 'testGenuineProfilePublicationNeverRepairsOrCreatesLease', 'testCompletedReplacementHistoryUsesOnlyExactStableRetainedRecords', 'testActualSessionTokenAndReadonlyProtection']) assert.ok(script.includes(method), method);
  assert.ok(script.includes('required private readonly native asset observation gate'));
  assert.ok(script.includes('Required readonly asset observation cases must not skip.'));
  assert.ok(script.includes('cp "$lock_copy" mac/Package.resolved'));
  assert.ok(inputs.includes('scripts/test-sync.sh') && inputs.includes('sync') && inputs.includes('mac/Sources') && inputs.includes('mac/Tests'));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-native-asset-registration-'));
  const names = ['scripts/test-sync.sh', 'sync/stress/build-native-asset-inspection-fixture.mts', 'mac/Tests/TextTextTests/NativeStressAssetProofTests.swift', 'mac/Tests/TextTextFileProviderKitTests/LocalVaultStressObservationTests.swift'];
  try {
    for (const name of names) {await fs.mkdir(path.dirname(path.join(temporary,name)),{recursive:true});await fs.writeFile(path.join(temporary,name),'original');}
    const original = await fingerprint(temporary,names);
    for (const name of names) {const target=path.join(temporary,name);await fs.writeFile(target,'changed');assert.notEqual(await fingerprint(temporary,names),original,name);await fs.writeFile(target,'original');}
  } finally {await fs.rm(temporary,{recursive:true,force:true});}
});
