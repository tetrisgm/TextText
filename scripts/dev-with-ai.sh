#!/usr/bin/env bash
# Run the dev server with a REAL AI provider, keyed from the login Keychain.
#
#   ./scripts/dev-with-ai.sh
#
# It loads the first configured dev key (Anthropic preferred, else OpenAI)
# and hands it to Next as TEXTTEXT_DEV_AI_KEY, which the /api/ai route uses in
# development in place of the workspace-saved key. The value is never printed
# and never passed as an argument. See scripts/dev-secrets.sh to store a key.
#
# To run against the local MOCK provider instead (no key, deterministic):
#   node scripts/mock-ai-provider.mjs &
#   TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/dev-secrets.sh
source "$ROOT/scripts/dev-secrets.sh"
load_dev_ai_key
exec npm run dev
