#!/usr/bin/env bash
# Compatibility name for the human-invoked Oracle web release.
set -euo pipefail
exec "$(dirname "$0")/ship.sh" --web-only "$@"
