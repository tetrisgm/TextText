#!/usr/bin/env bash
set -euo pipefail
exec </dev/null
cd "$(dirname "$0")/.."

migrations=(
  scripts/migrate-add-file-representation.mjs
  scripts/migrate-add-slug-history.mjs
  scripts/migrate-add-tags.mjs
  scripts/migrate-add-workspace-ai-config.mjs
  scripts/migrate-add-app-health.mjs
  scripts/migrate-add-oauth-token-lifecycle.mjs
  scripts/migrate-add-item-comments.mjs
  scripts/migrate-add-collab-epoch.mjs
  scripts/migrate-unified-documents.mjs
  scripts/migrate-enforce-canonical-documents.mjs
  scripts/migrate-flip-representation-to-markdown.mjs
  scripts/migrate-flip-representation-to-textpack.mjs
  scripts/migrate-drop-rename-revert-guard.mjs
)

for migration in "${migrations[@]}"; do
  echo ">> migrate database: $(basename "$migration" .mjs)"
  node "$migration"
done

echo ">> backfill content: AI guide notes"
npx tsx scripts/migrate-agent-guide-notes.ts

echo ">> audit database: canonical documents"
npx tsx scripts/audit-canonical-documents.ts
