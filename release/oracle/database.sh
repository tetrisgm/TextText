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
[ "$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$remote_root")" = "$remote_root" ] || {
  echo "Oracle root must be a normalized isolated path under /home/ubuntu." >&2
  exit 1
}
case "$remote_root" in
  /home/ubuntu/algorave|/home/ubuntu/algorave/*)
    echo "The TextText database root cannot overlap Algorave." >&2
    exit 1 ;;
esac
ssh_options=(-i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10)

if [ "$action" = --check ]; then
  ssh "${ssh_options[@]}" "$host" "sudo -n /usr/bin/node --env-file=/etc/texttext/runtime.env '$remote_root/current/scripts/verify-production-database.mjs'"
  exit 0
fi

id="database-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)-$$"
prepared="$ROOT/.texttext/oracle/$id"
node release/oracle/prepare-migrations.mjs --out "$prepared"
mkdir -p "$prepared/release/oracle"
for name in entrypoint.mjs start.mjs backup.mjs; do
  cp "$ROOT/release/oracle/$name" "$prepared/release/oracle/$name"
done
ssh "${ssh_options[@]}" "$host" bash -s -- "$remote_root" "$id" <<'REMOTE'
set -euo pipefail
root="$1"
incoming="$2"
[ -d "$root" ] && [ ! -L "$root" ] && [ "$(readlink -f "$root")" = "$root" ] || {
  echo "The TextText database root must be a real canonical directory." >&2
  exit 1
}
test -L "$root/current"
mkdir -p "$root/incoming"
mkdir "$root/incoming/$incoming"
REMOTE
COPYFILE_DISABLE=1 tar -czf - -C "$prepared" . | ssh "${ssh_options[@]}" "$host" "tar -xzf - -C '$remote_root/incoming/$id'"
ssh "${ssh_options[@]}" "$host" bash -s -- "$remote_root" "$id" <<'REMOTE'
set -euo pipefail
root="$1"
prepared="$root/incoming/$2"
[ -d "$root" ] && [ ! -L "$root" ] && [ "$(readlink -f "$root")" = "$root" ] || {
  echo "The TextText database root must be a real canonical directory." >&2
  exit 1
}
test -L "$root/current"
[ -d "$root/backups" ] && [ ! -L "$root/backups" ] &&
  [ "$(stat -c '%U:%G:%a' "$root/backups")" = "ubuntu:ubuntu:700" ] || {
    echo "The TextText backup directory must be owned by ubuntu with mode 0700." >&2
    exit 1
  }
sudo -n test -f /etc/texttext/backup.env
if sudo -n test -L /etc/texttext/backup.env ||
   [ "$(sudo -n stat -c '%u:%g:%a' /etc/texttext/backup.env)" != "0:0:600" ]; then
  echo "The TextText backup environment must be a root-owned regular file with mode 0600." >&2
  exit 1
fi
sudo -n systemctl is-active --quiet texttext-postgres.service
sudo -n /usr/bin/systemd-run \
  --unit=texttext-release-backup.service \
  --description="TextText release migration local database backup" \
  --wait --collect --pipe --quiet \
  --service-type=oneshot \
  --uid=ubuntu --gid=ubuntu \
  --working-directory="$prepared" \
  --nice=10 \
  --property=EnvironmentFile=/etc/texttext/backup.env \
  --property=UMask=0077 \
  --property=IOSchedulingClass=idle \
  --property=NoNewPrivileges=true \
  --property=PrivateTmp=true \
  --property=PrivateDevices=true \
  --property=ProtectSystem=strict \
  --property=ProtectHome=read-only \
  --property=ProtectKernelTunables=true \
  --property=ProtectKernelModules=true \
  --property=ProtectControlGroups=true \
  --property=RestrictSUIDSGID=true \
  --property="RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6" \
  --property=IPAddressDeny=any \
  --property=IPAddressAllow=localhost \
  --property="ReadWritePaths=$root/backups" \
  --property=MemoryMax=512M \
  --property=CPUQuota=50% \
  --property=TasksMax=128 \
  --property=TimeoutStartSec=15min \
  /usr/bin/node "$prepared/release/oracle/backup.mjs" </dev/null
ln -s "$root/current/node_modules" "$prepared/node_modules"
sudo -n /usr/bin/node "$root/current/release/oracle/bootstrap-database.mjs" \
  --env-file /etc/texttext/runtime.env --migrations-dir "$prepared" --migrate-only
REMOTE
