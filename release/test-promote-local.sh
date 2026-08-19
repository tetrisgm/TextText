#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/release/promote-local.sh"

bash -n "$SCRIPT"
"$SCRIPT" --help | grep -q 'does not publish'

python3 - "$SCRIPT" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source = path.read_text(encoding="utf-8")

required = {
    "exact release gates": 'scripts/verify-release.ts',
    "workflow receipt": 'verify-workflow-capabilities.sh',
    "signed build attestation": 'texttext-build-attestation.sh',
    "Developer ID identity check": 'SIGNATURE_DETAILS="$(codesign -dv',
    "staged app health": 'verify-app-health.sh',
    "production database guard": 'verify-production-database.mjs',
    "all migrations and backfills": 'run-release-migrations.sh',
    "runtime database alignment": 'sync-vercel-runtime-env.mjs',
    "prebuilt production build": 'vercel build --prod --yes',
    "prebuilt production deploy": 'vercel deploy --prebuilt --prod --yes --no-color',
    "explicit product alias": 'vercel alias set "$DEPLOYMENT_URL" texttext.app',
    "production rollback": 'vercel rollback "$PREVIOUS_DEPLOYMENT_URL" --yes',
    "authenticated workflow smoke": 'verify-workflow-live.ts',
    "atomic canonical installer": 'mac/scripts/install-local.sh',
    "exact runtime health": 'TEXTTEXT_REQUIRE_RUNTIME_HEALTH=1',
}
for label, needle in required.items():
    if needle not in source:
        raise SystemExit(f"promotion contract lost {label}: {needle}")

# Ordering is part of the safety contract. Local proof happens before mutation,
# production migrations precede deployment, the authenticated smoke precedes
# the local swap, and only the installer may touch /Applications.
ordered = [
    'scripts/verify-release.ts',
    'texttext-build-attestation.sh',
    'verify-app-health.sh',
    'run-release-migrations.sh',
    'vercel build --prod --yes',
    'vercel deploy --prebuilt --prod --yes --no-color',
    'verify-workflow-live.ts',
    'mac/scripts/install-local.sh',
]
positions = [source.index(needle) for needle in ordered]
if positions != sorted(positions):
    raise SystemExit("promotion safety steps are out of order")

for forbidden in (
    'mac/scripts/release.sh',
    'publish-mac-release.mjs',
    'notarize.sh',
    'prepare-testflight-build.sh',
    'altool',
):
    if forbidden in source:
        raise SystemExit(f"non-publishing promotion invokes forbidden lane: {forbidden}")

if '$(date -u +%Y%m%d%H%M%S)-$$' not in source:
    raise SystemExit("deployment identity is not unique per promotion attempt")
if 'BUILD=$((MAX_BUILD + 1))' not in source:
    raise SystemExit("local build identity no longer advances past installed builds")
if 'codesign -dv --verbose=4 "$BUILT_APP" 2>&1 | grep -q' in source:
    raise SystemExit("codesign identity check can fail under pipefail when grep exits early")

print("promote-local contract: ok")
PY
