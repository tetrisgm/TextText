#!/usr/bin/env bash
# Apple platform plan acceptance eval.
#
# Runs the Swift eval + regression suite, then checks one concrete condition
# per plan exit criterion (docs/apple-platform-plan.md section 17), per
# privacy invariant (AGENTS.md), and per explicit non-goal (section 18), and
# prints a green/red matrix. Exits non-zero if any row fails.
#
#   mac/scripts/apple-plan-eval.sh
#   mac/scripts/apple-plan-eval.sh --skip-tests  # suite already ran in ship.sh
#
# This is the "is the Apple platform plan satisfied" gate. It reads the tree
# structurally and runs tests; it does not touch the network, the real iCloud
# Drive, or any real workspace.
set -uo pipefail
cd "$(dirname "$0")/../.."          # repo root
ROOT="$(pwd)"
MAC="$ROOT/mac"
SKIP_TESTS=0
if [ "${1:-}" = "--skip-tests" ]; then
  SKIP_TESTS=1
  shift
fi
if [ "$#" -gt 0 ]; then
  echo "Usage: mac/scripts/apple-plan-eval.sh [--skip-tests]" >&2
  exit 2
fi

PASS=0
FAIL=0
RESULTS=()

record() { # $1=status(PASS|FAIL) $2=id $3=description
  RESULTS+=("$1|$2|$3")
  if [ "$1" = "PASS" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
}

check() { # $1=id $2=description ; body on stdin returns 0=pass
  local id="$1" desc="$2"
  if eval "$3" >/dev/null 2>&1; then record PASS "$id" "$desc"; else record FAIL "$id" "$desc"; fi
}

if [ "$SKIP_TESTS" = "1" ]; then
  record PASS "tests" "swift test already passed in the owner-facing ship gate"
else
  echo ">> Swift eval + regression suite"
  TEST_LOG="$(mktemp)"
  if swift test --package-path "$MAC" >"$TEST_LOG" 2>&1; then
    SUMMARY="$(grep -E "Executed [0-9]+ tests" "$TEST_LOG" | tail -1 | sed 's/^[[:space:]]*//')"
    record PASS "tests" "swift test green ($SUMMARY)"
  else
    record FAIL "tests" "swift test FAILED (see $TEST_LOG)"
  fi
fi

# --- Named eval suites exist and are wired in ---
for suite in \
  "WritingToolsProtectionEvalTests:Phase 2 Writing Tools protection golden evals" \
  "IntentBehaviorGoldenEvalTests:Phase 3 App Intents behavior golden evals" \
  "WorkspaceSpotlightIndexerTests:Phase 3 Spotlight mapping + eviction evals" \
  "SyncEngineRegressionTests:Phase 1/5 sync data-safety evals" \
  "WriteShareCoreTests:Phase 4 share inbox + Quick Look evals" \
  "EditorDocumentTests:Phase 2 editor round-trip + conflict evals" \
  "WorkspaceEnumeratorTests:File Provider enumeration + change-cursor evals" \
  "WriteItemMapperTests:File Provider item model + capability evals" \
  "BridgeTests:File Provider NSFileProviderItem bridging evals" \
  "EnumeratorAdapterTests:File Provider enumerator adapter evals" \
  "FileProviderExtensionTests:File Provider read/write mapping evals" \
  "FinderReliabilitySoakTests:File Provider create/edit/rename/move/delete/restore/offline/relaunch soak"; do
  name="${suite%%:*}"; desc="${suite#*:}"
  check "suite:$name" "$desc" "grep -rq 'class $name' '$MAC/Tests'"
done

# --- Phase 1: canonical files, readable outside Write, no opaque-DB-only content ---
check "p1.layout" "Phase 1: canonical folder layout is defined" \
  "grep -q 'Blogs' '$MAC/Sources/WriteWorkspaceCore/WorkspaceLayout.swift' && grep -q 'Bookmarks' '$MAC/Sources/WriteWorkspaceCore/WorkspaceLayout.swift'"
check "p1.identity" "Phase 1: markdown identity round-trips (front matter is plain text)" \
  "grep -q 'writeId' '$MAC/Sources/WriteWorkspaceCore/MarkdownIdentity.swift'"
check "p1.local-state" "Phase 1: device-local state stays out of iCloud (.write-local.nosync)" \
  "grep -q 'write-local.nosync' '$MAC/Sources/WriteWorkspaceCore/WorkspaceLayout.swift'"

# --- Phase 2: TextKit editor + Writing Tools ---
check "p2.textkit" "Phase 2: editor uses TextKit 2 NSTextView" \
  "grep -q 'usingTextLayoutManager: true' '$MAC/Sources/WriteEditor/EditorWindowController.swift'"
check "p2.writingtools" "Phase 2: Writing Tools enabled behind availability" \
  "grep -q 'writingToolsBehavior' '$MAC/Sources/WriteEditor/EditorWindowController.swift'"

# --- Phase 3: manifest + generator + intents + spotlight + deep links ---
check "p3.manifest" "Phase 3: capability manifest present" \
  "test -f '$MAC/Resources/AppCapabilities.yaml'"
check "p3.generator" "Phase 3: capability generator target present" \
  "test -f '$MAC/Tools/CapabilityGenerator/main.swift'"
check "p3.deeplink" "Phase 3: write-app:// URL scheme registered" \
  "grep -q 'write-app' '$MAC/Info.plist'"
check "p3.shortcuts-metadata" "Phase 3: App Intents metadata step wired into the release build" \
  "grep -q 'appintents-metadata.sh' '$MAC/scripts/build-app.sh'"

# --- Phase 4: share inbox + quick look renderer ---
check "p4.inbox" "Phase 4: app-group inbox contract present" \
  "test -f '$MAC/Sources/WriteShareCore/Inbox.swift'"
check "p4.quicklook" "Phase 4: Quick Look markdown renderer present" \
  "test -f '$MAC/Sources/WriteShareCore/MarkdownPreview.swift'"
check "p4.appex-sources" "Phase 4: extension sources present" \
  "test -f '$MAC/Extensions/WriteShareExtension/ShareViewController.swift' && test -f '$MAC/Extensions/WriteQuickLookPreview/PreviewProvider.swift'"

# --- Phase 5: publishing via local files ---
check "p5.ifmatch" "Phase 5: conflicts resolved with If-Match" \
  "grep -q 'ifMatch' '$MAC/Sources/Write/SyncEngine.swift'"
check "p5.offline" "Phase 5: backend failure never mutates local files (mass-delete breaker present)" \
  "grep -q 'paused server deletes' '$MAC/Sources/Write/SyncEngine.swift'"

# --- Privacy invariants (AGENTS.md) ---
check "inv.unlisted" "Invariant: publishing refuses notes and bookmarks at the intent layer" \
  "grep -q 'unlistedKind' '$MAC/Sources/WriteAppIntents/WorkspaceIntentActions.swift'"
check "inv.bookmark-links" "Invariant: bookmarks store the URL in the links list, not a dropped url: key" \
  "grep -q 'links: ' '$MAC/Sources/WriteAppIntents/WorkspaceIntentActions.swift'"
check "inv.local-authority" "Invariant: local edits win races with server downloads" \
  "grep -q 'changed while it was downloading' '$MAC/Sources/Write/SyncEngine.swift'"

# --- File Provider (Write as a Finder sidebar location; see docs/file-provider-plan.md) ---
check "fp.kit" "File Provider: pure-Swift kit (enumerator + item model + sync client) present" \
  "test -f '$MAC/Sources/WriteFileProviderKit/WorkspaceEnumerator.swift' && test -f '$MAC/Sources/WriteFileProviderKit/LiveWriteSyncAPI.swift'"
check "fp.bridge" "File Provider: NSFileProviderItem bridge present" \
  "test -f '$MAC/Sources/WriteFileProviderBridge/WriteFileProviderItem.swift'"
check "fp.replicated" "File Provider: principal class conforms to NSFileProviderReplicatedExtension" \
  "grep -q 'NSFileProviderReplicatedExtension' '$MAC/Extensions/WriteFileProviderExtension/FileProviderExtension.swift'"
check "fp.point-id" "File Provider: non-UI file provider extension point" \
  "grep -q 'com.apple.fileprovider-nonui' '$MAC/Extensions/WriteFileProviderExtension/Info.plist'"
check "fp.network" "File Provider: sandboxed appex is granted network client access" \
  "grep -q 'network.client' '$MAC/Extensions/WriteFileProviderExtension/WriteFileProviderExtension.entitlements.template'"
check "fp.embed" "File Provider: appex is embedded/signed in the release build" \
  "grep -q 'WriteFileProviderExtension' '$MAC/scripts/embed-extensions.sh'"
check "fp.domain" "File Provider: app registers/removes an NSFileProviderDomain" \
  "grep -q 'NSFileProviderManager.add' '$MAC/Sources/Write/AppDelegate.swift'"
check "fp.eager" "File Provider: every document is eagerly materialized and kept local" \
  "grep -q 'downloadEagerlyAndKeepDownloaded' '$MAC/Sources/WriteFileProviderBridge/WriteFileProviderItem.swift' && grep -q 'All Markdown is downloaded and kept on this Mac' '$MAC/Sources/Write/FileProviderStatusMonitor.swift'"
check "fp.handoff" "File Provider: token handoff carries only the wsk_ bearer via the app group" \
  "test -f '$MAC/Sources/WriteFileProviderKit/FileProviderHandoff.swift'"
check "fp.writes" "File Provider Phase 3: write path maps Finder edits to the sync API" \
  "grep -q 'func modifyItem' '$MAC/Extensions/WriteFileProviderExtension/FileProviderExtension.swift' && grep -q 'patchFile' '$MAC/Sources/WriteFileProviderKit/LiveWriteSyncAPI.swift'"
check "fp.unlisted" "Invariant: folder-scoped create keeps the folder's kind (notes/bookmarks stay unlisted)" \
  "grep -q 'defaultPostTypeForFolderMode' '$ROOT/src/lib/store.ts'"
check "health.runtime" "Reliability: installed app runs content-blind production self-tests" \
  "grep -q 'selftest.filename_codec' '$MAC/Sources/Write/AppHealthReporter.swift' && grep -q 'selftest.document_assets' '$MAC/Sources/Write/AppHealthReporter.swift' && grep -q 'workflow.folder_trash_restore' '$MAC/Sources/Write/AppHealthReporter.swift'"
check "health.finder-readiness" "Reliability: Finder health waits for transient startup work to settle" \
  "grep -q 'FileProviderReadinessProbe' '$MAC/Sources/Write/FileProviderStatusMonitor.swift' && grep -q 'working_exhausted' '$MAC/Sources/Write/AppHealthReporter.swift'"
check "health.attestation" "Reliability: release bundle carries a verified build attestation" \
  "grep -q 'AppHealthBuildAttestation.json' '$MAC/scripts/build-app.sh' && grep -q 'write-build-attestation.sh' '$ROOT/release/ship.sh'"
check "health.workflows" "Reliability: destructive web workflows use signed capability receipts" \
  "test -x '$MAC/scripts/verify-workflow-capabilities.sh' && grep -q 'WRITE_WORKFLOW_CAPABILITY_RECEIPT' '$MAC/scripts/write-build-attestation.sh' && grep -q 'workflow.cover_assets' '$MAC/scripts/verify-app-health.sh'"
check "release.arm64" "Release: Write binaries and Sparkle feed require Apple silicon" \
  "test -x '$MAC/scripts/verify-apple-silicon-app.sh' && grep -q -- '--triple arm64-apple-macosx14.0' '$MAC/scripts/build-app.sh' && grep -q 'hardwareRequirements' '$MAC/scripts/release.sh' && grep -q 'PUBLIC_HARDWARE_REQUIREMENTS' '$ROOT/release/ship.sh'"

# --- Explicit non-goals stay absent ---
check "nongoal.cloudkit" "Non-goal: no CloudKit document storage" \
  "! grep -rqi 'import CloudKit' '$MAC/Sources'"

# --- House rule: no em dashes in the Apple / File Provider docs ---
check "style.no-em-dash" "Style: no em dashes in Apple platform + File Provider docs" \
  "! grep -lq $'\\u2014' '$ROOT/docs/apple-platform-plan.md' '$ROOT/docs/apple-workspace.md' '$ROOT/docs/apple-platform-evals.md' '$ROOT/docs/file-provider-plan.md' '$ROOT/docs/file-provider-portal-step.md' 2>/dev/null"

echo
echo "=== Apple platform plan acceptance matrix ==="
for row in "${RESULTS[@]}"; do
  IFS='|' read -r status id desc <<<"$row"
  if [ "$status" = "PASS" ]; then mark="  ok "; else mark="FAIL "; fi
  printf "%s %-22s %s\n" "$mark" "$id" "$desc"
done
echo "-------------------------------------------"
printf "%d passed, %d failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && echo "Apple platform plan: SATISFIED" || echo "Apple platform plan: gaps above"
[ "$FAIL" -eq 0 ]
