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
    "private production database guard": '"$ROOT/release/oracle/database.sh" --check',
    "all migrations and backfills": '"$ROOT/release/oracle/database.sh" --migrate',
    "build committed source": 'TEXTTEXT_ORACLE_ARTIFACT= npx tsx',
    "Oracle deployment": '"$ROOT/release/oracle/deploy.sh"',
    "public deployment identity": '${origin}/api/app/build?promotion=${expected}-${attempt}',
    "exact public deployment identity": '(await response.json()).buildId === expected',
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
    '"$ROOT/release/oracle/database.sh" --check',
    '"$ROOT/release/oracle/database.sh" --migrate',
    '"$ROOT/release/oracle/deploy.sh"',
    '${origin}/api/app/build?promotion=${expected}-${attempt}',
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
    'npx vercel',
    'sync-vercel-runtime-env.mjs',
    'require_release_secret DATABASE_URL',
):
    if forbidden in source:
        raise SystemExit(f"non-publishing promotion invokes forbidden lane: {forbidden}")

if 'PROMOTION_ID="tt-${BUILD}-${SOURCE_COMMIT:0:8}-$(printf \'%x\' "$(date -u +%s)")"' not in source:
    raise SystemExit("deployment identity is not unique per promotion attempt")
if 'BUILD=$((MAX_BUILD + 1))' not in source:
    raise SystemExit("local build identity no longer advances past installed builds")
if 'codesign -dv --verbose=4 "$BUILT_APP" 2>&1 | grep -q' in source:
    raise SystemExit("codesign identity check can fail under pipefail when grep exits early")

# The shared Oracle helper owns application rollback and authenticated smoke.
# Keeping the smoke inside its trap means a failed workflow cannot leave the
# unverified server release active or proceed to the local application swap.
deploy = (path.parent / "oracle" / "deploy.sh").read_text(encoding="utf-8")
for needle in ('trap rollback EXIT', 'release/oracle/smoke.mjs', '--scratch', '--env-file /etc/texttext/runtime.env'):
    if needle not in deploy:
        raise SystemExit(f"Oracle promotion contract lost {needle}")
if not deploy.index('trap rollback EXIT') < deploy.index('release/oracle/smoke.mjs') < deploy.index('trap - EXIT'):
    raise SystemExit("authenticated workflow smoke is outside Oracle rollback protection")

print("promote-local contract: ok")
PY
