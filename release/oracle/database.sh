#!/usr/bin/env bash
# Manual release database operations. Credentials stay on the Oracle machine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
action="${1:---check}"
[[ "$action" = --check || "$action" = --migrate ]] || { echo "Usage: database.sh [--check|--migrate]" >&2; exit 1; }
host="${TEXTTEXT_ORACLE_HOST:-}"
if [ -z "$host" ] && [ -f "$HOME/.config/texttext/oracle-host" ]; then
  IFS= read -r host < "$HOME/.config/texttext/oracle-host"
fi
remote_root="${TEXTTEXT_ORACLE_ROOT:-/home/ubuntu/texttext}"
[[ "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@-]*$ ]] || { echo "Set TEXTTEXT_ORACLE_HOST to the existing Oracle SSH destination." >&2; exit 1; }
[[ "$remote_root" =~ ^/home/ubuntu/[a-zA-Z0-9/_-]+$ ]] || exit 1
ssh_options=(-i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10)

if [ "$action" = --check ]; then
  ssh "${ssh_options[@]}" "$host" "sudo -n /usr/bin/node --env-file=/etc/texttext/runtime.env '$remote_root/current/scripts/verify-production-database.mjs'"
  exit 0
fi

id="database-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)-$$"
prepared="$ROOT/.texttext/oracle/$id"
node release/oracle/prepare-migrations.mjs --out "$prepared"
ssh "${ssh_options[@]}" "$host" "mkdir -p '$remote_root/incoming'; mkdir '$remote_root/incoming/$id'"
COPYFILE_DISABLE=1 tar -czf - -C "$prepared" . | ssh "${ssh_options[@]}" "$host" "tar -xzf - -C '$remote_root/incoming/$id'"
ssh "${ssh_options[@]}" "$host" bash -s -- "$remote_root" "$id" <<'REMOTE'
set -euo pipefail
root="$1"
prepared="$root/incoming/$2"
test -L "$root/current"
ln -s "$root/current/node_modules" "$prepared/node_modules"
sudo -n systemctl start texttext-backup.service
sudo -n /usr/bin/node "$root/current/release/oracle/bootstrap-database.mjs" \
  --env-file /etc/texttext/runtime.env --migrations-dir "$prepared" --migrate-only
REMOTE
