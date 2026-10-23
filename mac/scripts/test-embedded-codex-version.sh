#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/texttext-codex-version.XXXXXX")"
eval "$(sed -n '/^embedded_codex_version() {/,/^}/p' "$ROOT/mac/scripts/build-app.sh")"
export CODEX_VERSION_TEST_MARKER="$FIXTURE/calls"
: > "$CODEX_VERSION_TEST_MARKER"
cat > "$FIXTURE/codex" <<'SH'
#!/bin/sh
printf 'called\n' >> "$CODEX_VERSION_TEST_MARKER"
[ "$1" = '--version' ] || exit 2
printf '%s\n' "${CODEX_VERSION_TEST_RESULT-codex-cli 0.153.4}"
exit "${CODEX_VERSION_TEST_EXIT:-0}"
SH
chmod +x "$FIXTURE/codex"

# A sandbox-inheriting helper cannot start from this caller. Explicit verified
# metadata must avoid launching it, while retaining its exact version.
actual="$(TEXTTEXT_EMBEDDED_CODEX_VERSION='codex-cli 0.153.4' CODEX_VERSION_TEST_EXIT=133 embedded_codex_version "$FIXTURE/codex")"
[[ "$actual" == 'codex-cli 0.153.4' && ! -s "$CODEX_VERSION_TEST_MARKER" ]]
for invalid in '' 'unknown' 'codex-cli 0.153.4 unexpected' $'codex-cli 0.153.4\nsecond line'; do
  if TEXTTEXT_EMBEDDED_CODEX_VERSION="$invalid" embedded_codex_version "$FIXTURE/codex" >/dev/null 2>&1; then
    echo "Invalid explicit runtime version accepted" >&2
    exit 1
  fi
done
[[ ! -s "$CODEX_VERSION_TEST_MARKER" ]]

(
  unset TEXTTEXT_EMBEDDED_CODEX_VERSION
  [[ "$(embedded_codex_version "$FIXTURE/codex")" == 'codex-cli 0.153.4' ]]
  [[ -s "$CODEX_VERSION_TEST_MARKER" ]]
  if CODEX_VERSION_TEST_EXIT=133 embedded_codex_version "$FIXTURE/codex" >/dev/null; then
    echo "Failed external runtime was accepted" >&2
    exit 1
  else
    [[ "$?" == '133' ]]
  fi
  if CODEX_VERSION_TEST_RESULT='bad version' embedded_codex_version "$FIXTURE/codex" >/dev/null 2>&1; then
    echo "Invalid external runtime version accepted" >&2
    exit 1
  fi
)
echo 'Embedded Codex version regressions passed; no installed runtime executed.'
