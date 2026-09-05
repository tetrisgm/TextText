#!/usr/bin/env bash
# Apply every database migration, in order, against the release database.
#
# The order matters, so the list is explicit rather than globbed. But an
# explicit list drifts: migrate-add-revision.mjs and migrate-add-starred.mjs
# both sat on disk for weeks without being listed here, so a freshly
# provisioned database would have lacked the `revision` and `starred` columns,
# and production only worked because it had been migrated by hand. The coverage
# check below makes that impossible. Add a migration to scripts/ and this fails
# until it is placed in the order.
#
#   scripts/run-release-migrations.sh            apply
#   scripts/run-release-migrations.sh --check    verify coverage only
set -euo pipefail
exec </dev/null
cd "$(dirname "$0")/.."

migrations=(
  scripts/migrate-add-file-representation.mjs
  scripts/migrate-add-slug-history.mjs
  scripts/migrate-add-tags.mjs
  scripts/migrate-add-starred.mjs
  scripts/migrate-add-workspace-ai-config.mjs
  scripts/migrate-add-workspace-agent-config.mjs
  scripts/migrate-add-assistant-conversation-history.mjs
  scripts/migrate-raise-assistant-history-limits.mjs
  scripts/migrate-add-app-health.mjs
  scripts/migrate-add-oauth-token-lifecycle.mjs
  scripts/migrate-add-item-comments.mjs
  scripts/migrate-add-revision.mjs
  scripts/migrate-add-collab-epoch.mjs
  scripts/migrate-unified-documents.mjs
  scripts/migrate-enforce-canonical-documents.mjs
  scripts/migrate-flip-representation-to-markdown.mjs
  scripts/migrate-flip-representation-to-textpack.mjs
  scripts/migrate-drop-rename-revert-guard.mjs
  scripts/migrate-add-document-fields-index.mjs
  scripts/migrate-add-document-responses.mjs
  scripts/migrate-add-deleted-accounts.mjs
  scripts/migrate-add-user-identities.mjs
  scripts/migrate-add-content-reports.mjs
  scripts/migrate-drop-edit-token-hash.mjs
  scripts/migrate-add-mcp-connections.mjs
  scripts/migrate-add-ai-write-proposals.mjs
  scripts/migrate-add-api-token-kind.mjs
  scripts/migrate-add-template-retirement.mjs
  scripts/migrate-drop-oauth.mjs
  scripts/migrate-home-layout-default.mjs
  scripts/migrate-drop-card-style.mjs
  scripts/migrate-drop-template-capabilities.mjs
  scripts/migrate-post-type-to-item-kind.mjs
  scripts/migrate-add-template-authoring-source.mjs
  scripts/migrate-backfill-word-count.mjs
  scripts/migrate-add-agent-changes.mjs
)

missing=()
for path in scripts/migrate-*.mjs; do
  found=""
  for listed in "${migrations[@]}"; do
    if [ "$listed" = "$path" ]; then found=1; break; fi
  done
  if [ -z "$found" ]; then missing+=("$path"); fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "Migrations exist but are not in the release order:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "Add each to the migrations array in $0, where it must run." >&2
  exit 1
fi
for listed in "${migrations[@]}"; do
  if [ ! -f "$listed" ]; then
    echo "Release order lists a migration that does not exist: $listed" >&2
    exit 1
  fi
done

if [ "${1:-}" = "--check" ]; then
  printf '{"status":"current","migrations":%d}\n' "${#migrations[@]}"
  exit 0
fi

for migration in "${migrations[@]}"; do
  echo ">> migrate database: $(basename "$migration" .mjs)"
  node "$migration"
done

echo ">> migrate content: blog layout to Home"
npx tsx scripts/migrate-blog-layout-to-home.ts

echo ">> backfill content: AI guide notes"
npx tsx scripts/migrate-agent-guide-notes.ts

echo ">> audit database: canonical documents"
npx tsx scripts/audit-canonical-documents.ts
