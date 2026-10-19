#!/usr/bin/env bash
# Manual, isolated sync regression suite. Never contacts production or installs.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" != "--native-only" ]; then
  exec node sync/verify.mjs "$@"
fi
node --test windows/scripts/handoff-publication-proof.test.mjs windows/scripts/stress-browser-relay.test.mjs sync/stress/resource-sampler.test.mjs sync/stress/resource-ownership.test.mjs
# SwiftPM's Store manifest omits Sparkle; preserve the standalone resolution.
lock_copy=$(mktemp)
cp mac/Package.resolved "$lock_copy"
test_log=$(mktemp)
trap 'cp "$lock_copy" mac/Package.resolved; rm -f "$lock_copy" "$test_log"' EXIT
TEXTTEXT_STORE=1 TEXTTEXT_VAULT_HTTP_TEST=1 swift test --package-path mac --jobs 2 \
  --filter 'LocalVault(SavedRenameIntegrationTests|FolderPolicyTests|QueuedUploadPathPolicyTests|SavedRenamePolicyTests|SharedRenameTests|SharedPathPolicyTests|FolderCaseSyncTests|FolderCaseHTTPTests|ConflictRetentionTests|ReplacementSyncTests|SharedReplacementFenceTests|RecoveryAssetTests|OpaqueReplacementTests|MirrorPolicyHostTests|AccountStateAdoptionTests|AccountRootOwnershipTests|AccountIdentityTests|SyncTests|SharedEditingTests|RecoveryTests|DeviceStateTests|HTTPContractTests|SessionLifecycleTests|ConnectionControllerTests|CollaborationTests)|StableFileSnapshotTests|DocumentCreationTests|RemoteDocumentStoreTests|ReplacementRecoveryRegistryTests|RetainedFileReplacementTests|RetainedFileRemovalTests|RetainedReplacementProfileTests|FolderCaseRenameTests|FolderRenameBridgeTests|FolderPropagationProfileTests|FolderSyncRecoveryBridgeTests|LocalHandoffProfileTests|LocalHandoffBridgeTests|MirrorTombstoneIntegrationTests|SharedRenameProfileTests|ProtectedRenameTransportTests|MissingManifestVisibilityTests|QueuedUploadPathAdoptionTests' 2>&1 | tee "$test_log"
# Swift exits successfully even if a filter selects zero tests. Fail closed.
for suite in SavedRenameIntegration FolderPolicy QueuedUploadPathPolicy SavedRenamePolicy SharedRename SharedPathPolicy FolderCaseSync FolderCaseHTTP ConflictRetention ReplacementSync SharedReplacementFence RecoveryAsset OpaqueReplacement MirrorPolicyHost AccountStateAdoption AccountRootOwnership AccountIdentity Sync SharedEditing Recovery DeviceState HTTPContract SessionLifecycle ConnectionController Collaboration; do
  grep -Eq "Test Case '.*LocalVault${suite}Tests .*' passed" "$test_log" || {
    echo "Required native sync suite did not execute: LocalVault${suite}Tests" >&2
    exit 1
  }
done

for suite in DocumentCreation RemoteDocumentStore StableFileSnapshot ReplacementRecoveryRegistry RetainedFileReplacement RetainedFileRemoval RetainedReplacementProfile FolderCaseRename FolderRenameBridge FolderPropagationProfile FolderSyncRecoveryBridge LocalHandoffProfile LocalHandoffBridge MirrorTombstoneIntegration SharedRenameProfile ProtectedRenameTransport MissingManifestVisibility QueuedUploadPathAdoption; do
  grep -Eq "Test Case '.*${suite}Tests .*' passed" "$test_log" || {
    echo "Required native creation suite did not execute: ${suite}Tests" >&2
    exit 1
  }
done

# BEGIN required private readonly native asset observation gate
# A file actor has no schema authority. Exercise the actual product validator
# in a fresh controlled page; never reuse an old fixture or normal app profile.
asset_fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/texttext-native-asset-inspection.XXXXXX")
asset_fixture="$asset_fixture_root/schema"
node --import tsx sync/stress/build-native-asset-inspection-fixture.mts "$asset_fixture"
TEXTTEXT_ASSET_INSPECTION_FIXTURE="$asset_fixture" TEXTTEXT_STORE=1 swift test --package-path mac --jobs 2 \
  -Xswiftc -DTEXTTEXT_STRESS_ACTOR \
  --filter 'NativeStressAssetProofTests|LocalVaultStressObservationTests' 2>&1 | tee "$test_log"
for suite in NativeStressAssetProofTests LocalVaultStressObservationTests; do
  grep -Eq "Test Suite '${suite}' passed" "$test_log" || {
    echo "Required readonly asset observation suite did not pass: $suite" >&2
    exit 1
  }
done
for method in testStrictRequestBeforeReads testActualBytesAssetsAndNoSchemaDuplication testMalformedUTF8ArchiveNamesRefuseBeforeIdentity testECMAScriptCanonicalRetainsAbsenceAndNumericSemantics testReadonlyReadRefusesLinksAndPreservesBytes testActualWKProductSchemaRejectsHiddenInvalidFields testAbsentPrivateDirectoryStaysAbsent testCompletedFolderHistoryAttestsAndPendingRefusesWithoutCreatingLease testGenuineProfilePublicationNeverRepairsOrCreatesLease testCompletedReplacementHistoryUsesOnlyExactStableRetainedRecords testActualSessionTokenAndReadonlyProtection; do
  grep -Eq "Test Case '.*${method}.*' passed" "$test_log" || {
    echo "Required readonly asset observation method did not pass: $method" >&2
    exit 1
  }
done
if grep -Eq "Test Case '.*(NativeStressAssetProofTests|LocalVaultStressObservationTests).*' skipped" "$test_log"; then
  echo 'Required readonly asset observation cases must not skip.' >&2
  exit 1
fi
# END required private readonly native asset observation gate

# The Windows file/sync core is portable .NET. Run its algorithm and journal
# regressions on the Mac gate as well as the actual Windows candidate build.
dotnet run --project windows/TextText.Core.Tests/TextText.Core.Tests.csproj \
  --configuration Release 2>&1 | tee "$test_log"
grep -q 'All native file and durable sync regression tests passed.' "$test_log" || {
  echo 'Required Windows sync regressions did not execute.' >&2
  exit 1
}

dotnet run --project windows/TextText.Windows.Tests/TextText.Windows.Tests.csproj \
  --configuration Release 2>&1 | tee "$test_log"
grep -q 'All Windows bridge startup tests passed.' "$test_log" || {
  echo 'Required Windows bridge regressions did not execute.' >&2
  exit 1
}

# Read-only private actor proofs are portable only where OS identity permits;
# this project explicitly refuses filesystem proof on the Mac and exercises its
# configuration, canonical document and real session-binding logic instead.
dotnet run --project windows/TextText.LiveAcceptance.Tests/TextText.LiveAcceptance.Tests.csproj \
  --configuration Release 2>&1 | tee "$test_log"
grep -Eq '[1-9][0-9]* portable actor checks passed; Windows filesystem checks require actual PC' "$test_log" || {
  echo 'Required private Windows actor read-proof checks did not execute.' >&2
  exit 1
}
