#!/usr/bin/env bash
# Explicit human invocation only. No public Mac update is published.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node release/ship-all.mjs "$@"
