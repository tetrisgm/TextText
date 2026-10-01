#!/usr/bin/env bash
# Called only by a human-invoked release. Never run from a scheduled job.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1; shift ;;
  --help|-h)
    echo "Usage: release/oracle/deploy.sh [--dry-run]"
    echo "Set TEXTTEXT_ORACLE_HOST=ubuntu@host; optional TEXTTEXT_ORACLE_ARTIFACT reuses a verified archive."
    exit 0 ;;
esac
[ "$#" -eq 0 ] || { echo "Unexpected deployment argument." >&2; exit 1; }

ARTIFACT="${TEXTTEXT_ORACLE_ARTIFACT:-}"
if [ -z "$ARTIFACT" ]; then
  RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
  export NEXT_DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID:-texttext-oracle-$RELEASE_ID}"
  export TEXTTEXT_STANDALONE=1
  export TEXTTEXT_NEXT_DIST_DIR=.texttext/oracle-build
  echo ">> build the Oracle release on the Mac"
  node scripts/with-local-database.mjs npm run build
  MIGRATIONS="$ROOT/.texttext/oracle/migrations-$RELEASE_ID"
  node release/oracle/prepare-migrations.mjs --out "$MIGRATIONS"
  ARTIFACT="$ROOT/.texttext/oracle/texttext-$RELEASE_ID.tar.gz"
  node release/oracle/package.mjs --dist-dir "$TEXTTEXT_NEXT_DIST_DIR" --migrations-dir "$MIGRATIONS" --out "$ARTIFACT"
fi

ARTIFACT="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$ARTIFACT")"
METADATA="$(node release/oracle/verify-package.mjs "$ARTIFACT")"
DEPLOYMENT_ID="$(printf '%s' "$METADATA" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.parse(s).deploymentId))')"
if [ "$DRY_RUN" = "1" ]; then
  echo "Verified Oracle archive: $ARTIFACT"
  echo "Deployment identity: $DEPLOYMENT_ID"
  echo "Dry run complete. No server was contacted."
  exit 0
fi

ORACLE_HOST="${TEXTTEXT_ORACLE_HOST:-}"
if [ -z "$ORACLE_HOST" ] && [ -f "$HOME/.config/texttext/oracle-host" ]; then
  ORACLE_HOST="$(cat "$HOME/.config/texttext/oracle-host")"
fi
REMOTE_ROOT="${TEXTTEXT_ORACLE_ROOT:-/home/ubuntu/texttext}"
BOOTSTRAP="${TEXTTEXT_ORACLE_BOOTSTRAP:-0}"
[[ "$BOOTSTRAP" = 0 || "$BOOTSTRAP" = 1 ]] || { echo "TEXTTEXT_ORACLE_BOOTSTRAP must be 0 or 1." >&2; exit 1; }
[[ "$ORACLE_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@-]*$ ]] || { echo "Set TEXTTEXT_ORACLE_HOST to the existing SSH destination." >&2; exit 1; }
[[ "$REMOTE_ROOT" =~ ^/home/ubuntu/[a-zA-Z0-9/_-]+$ ]] || { echo "Oracle root must be an isolated path under /home/ubuntu." >&2; exit 1; }
[ "$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$REMOTE_ROOT")" = "$REMOTE_ROOT" ] || {
  echo "Oracle root must be a normalized isolated path under /home/ubuntu." >&2
  exit 1
}
case "$REMOTE_ROOT" in
  /home/ubuntu/algorave|/home/ubuntu/algorave/*)
    echo "The TextText deployment root cannot overlap Algorave." >&2
    exit 1 ;;
esac
RELEASE_NAME="$(date -u +%Y%m%dT%H%M%SZ)-$DEPLOYMENT_ID-$(node -e 'console.log(require("node:crypto").randomBytes(3).toString("hex"))')"
SSH_OPTIONS=(-i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10)
echo ">> check the existing Oracle runtime"
ssh "${SSH_OPTIONS[@]}" "$ORACLE_HOST" bash -s -- "$REMOTE_ROOT" "$RELEASE_NAME" "$BOOTSTRAP" <<'REMOTE'
set -euo pipefail
root="$1"
release="$2"
bootstrap="$3"
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = aarch64 ]
[ "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" = 22 ]
sudo -n test -f /etc/texttext/runtime.env
[ "$(sudo -n stat -c %a /etc/texttext/runtime.env)" = 600 ]
sudo -n systemctl cat texttext.service >/dev/null
if sudo -n test -L /etc/systemd/system/texttext-backup.service; then
  echo "Refusing to replace a symlinked TextText backup unit." >&2
  exit 1
fi
if sudo -n test -e /etc/systemd/system/texttext-backup.service; then
  if ! sudo -n test -f /etc/systemd/system/texttext-backup.service ||
     [ "$(sudo -n stat -c '%u:%g' /etc/systemd/system/texttext-backup.service)" != "0:0" ]; then
    echo "The installed TextText backup unit must be a root-owned regular file." >&2
    exit 1
  fi
fi
if [ "$bootstrap" = 1 ] && { [ -e "$root/current" ] || [ -L "$root/current" ]; }; then
  echo "Bootstrap is allowed only before the first application release." >&2
  exit 1
fi
if [ -e "$root/current" ] && [ ! -L "$root/current" ]; then
  echo "Refusing to replace a current directory; expected a release symlink." >&2
  exit 1
fi
sudo -n test -f /etc/texttext/backup.env
if sudo -n test -L /etc/texttext/backup.env ||
   [ "$(sudo -n stat -c '%u:%g:%a' /etc/texttext/backup.env)" != "0:0:600" ]; then
  echo "The TextText backup environment must be a root-owned regular file with mode 0600." >&2
  exit 1
fi
[ -x /usr/bin/systemd-run ]
if [ -e "$root" ] || [ -L "$root" ]; then
  [ -d "$root" ] && [ ! -L "$root" ] && [ "$(readlink -f "$root")" = "$root" ] || {
    echo "The TextText deployment root must be a real canonical directory." >&2
    exit 1
  }
else
  mkdir -p "$root"
fi
[ ! -L "$root" ] && [ "$(readlink -f "$root")" = "$root" ] || {
  echo "The TextText deployment root must be a real canonical directory." >&2
  exit 1
}
mkdir -p "$root/releases" "$root/incoming"
if [ -e "$root/backups" ] || [ -L "$root/backups" ]; then
  [ -d "$root/backups" ] && [ ! -L "$root/backups" ] &&
    [ "$(stat -c '%U:%G:%a' "$root/backups")" = "ubuntu:ubuntu:700" ] || {
      echo "The TextText backup directory must be owned by ubuntu with mode 0700." >&2
      exit 1
    }
else
  mkdir -m 0700 "$root/backups"
fi
[ ! -e "$root/releases/$release" ]
mkdir "$root/incoming/$release"
REMOTE

echo ">> transfer the verified release"
scp "${SSH_OPTIONS[@]}" "$ARTIFACT" "$ORACLE_HOST:$REMOTE_ROOT/incoming/$RELEASE_NAME/release.tar.gz"
# The destination name is fixed, so rewrite only the checksum's filename.
CHECKSUM="$(node -e 'process.stdout.write(require("node:fs").readFileSync(process.argv[1],"utf8").split(/\s+/)[0])' "$ARTIFACT.sha256")"
printf '%s  release.tar.gz\n' "$CHECKSUM" | ssh "${SSH_OPTIONS[@]}" "$ORACLE_HOST" "cat > '$REMOTE_ROOT/incoming/$RELEASE_NAME/release.tar.gz.sha256'"

echo ">> migrate, switch TextText, and verify"
ssh "${SSH_OPTIONS[@]}" "$ORACLE_HOST" bash -s -- "$REMOTE_ROOT" "$RELEASE_NAME" "$DEPLOYMENT_ID" "$BOOTSTRAP" <<'REMOTE'
set -euo pipefail
root="$1"
release="$root/releases/$2"
incoming="$root/incoming/$2"
expected="$3"
bootstrap="$4"
previous=""
switched=0
backup_unit=/etc/systemd/system/texttext-backup.service
backup_unit_new="/etc/systemd/system/.texttext-backup.service.new.$$"
backup_unit_previous="/etc/systemd/system/.texttext-backup.service.previous.$$"
backup_unit_had_previous=0
backup_unit_replaced=0
if [ -L "$root/current" ]; then previous="$(readlink -f "$root/current")"; fi
case "$previous" in ""|"$root/releases/"*) ;; *) echo "Current release is outside TextText releases." >&2; exit 1 ;; esac

rollback() {
  result=$?
  if [ "$result" -ne 0 ]; then
    if [ "$backup_unit_replaced" = 1 ]; then
      echo "TextText verification failed; restoring the previous backup unit." >&2
      if [ "$backup_unit_had_previous" = 1 ]; then
        if ! sudo -n mv -Tf "$backup_unit_previous" "$backup_unit"; then
          echo "Could not restore $backup_unit_previous; recover that saved unit manually." >&2
        fi
      else
        sudo -n rm -f "$backup_unit" || true
      fi
      sudo -n rm -f "$backup_unit_new" || true
      sudo -n systemctl daemon-reload || true
    fi
    if [ "$switched" = 1 ]; then
      echo "TextText verification failed; restoring the previous application release." >&2
      if [ -n "$previous" ]; then
        ln -s "$previous" "$root/.rollback-$$"
        mv -Tf "$root/.rollback-$$" "$root/current"
        sudo -n systemctl restart texttext.service || true
      else
        sudo -n systemctl stop texttext.service || true
        rm "$root/current"
      fi
    fi
  fi
  exit "$result"
}
trap rollback EXIT

cd "$incoming"
sha256sum --check release.tar.gz.sha256
mkdir "$release"
tar --extract --gzip --file release.tar.gz --directory "$release" --no-same-owner --no-same-permissions
cd "$release"
/usr/bin/node -e 'const m=require("./oracle-release.json");if(m.platform!==process.platform||m.architecture!==process.arch||m.deploymentId!==process.argv[1])process.exit(1);require("sharp");require("@next/swc-linux-arm64-gnu");' "$expected"
backup_unit_template="$release/release/oracle/texttext-backup.service"
backup_unit_rendered="$incoming/texttext-backup.service"
[ -f "$backup_unit_template" ] && [ ! -L "$backup_unit_template" ]
sed "s#/home/ubuntu/texttext#$root#g" "$backup_unit_template" > "$backup_unit_rendered"
chmod 0644 "$backup_unit_rendered"
sudo -n systemd-analyze verify "$backup_unit_rendered"
mkdir -p "$release/.texttext/oracle-build/cache" "$root/state"
if [ -n "$previous" ]; then
  # Use the checksum-verified incoming implementation so backup behavior does
  # not depend on the outgoing release. The transient unit reads the existing
  # root-owned environment before dropping to ubuntu, cannot use the network
  # beyond loopback, and must finish before a migration or symlink change.
  sudo -n systemctl is-active --quiet texttext-postgres.service
  sudo -n /usr/bin/systemd-run \
    --unit=texttext-deploy-backup.service \
    --description="TextText pre-deploy local database backup" \
    --wait --collect --pipe --quiet \
    --service-type=oneshot \
    --uid=ubuntu --gid=ubuntu \
    --working-directory="$release" \
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
    /usr/bin/node "$release/release/oracle/backup.mjs" </dev/null
fi
if [ "$bootstrap" = 1 ]; then
  [ -z "$previous" ] || { echo "Refusing to bootstrap an existing application release." >&2; exit 1; }
  sudo -n /usr/bin/node "$release/release/oracle/bootstrap-database.mjs" --env-file /etc/texttext/runtime.env
else
  sudo -n /usr/bin/node "$release/release/oracle/bootstrap-database.mjs" --env-file /etc/texttext/runtime.env --migrate-only
fi
ln -s "$release" "$root/.current-$$"
mv -Tf "$root/.current-$$" "$root/current"
switched=1
sudo -n systemctl restart texttext.service

healthy=0
for attempt in $(seq 1 30); do
  if /usr/bin/node --input-type=module - "$expected" <<'CHECK'
const origin = "http://127.0.0.1:3400";
try {
  const build = await fetch(`${origin}/api/app/build`, { signal: AbortSignal.timeout(3000), headers: { "cache-control": "no-cache" } });
  if (!build.ok) process.exit(1);
  const data = await build.json();
  if (data.buildId !== process.argv[2] && data.deploymentId !== process.argv[2]) process.exit(1);
  const signin = await fetch(`${origin}/signin`, { signal: AbortSignal.timeout(5000), redirect: "manual" });
  if (signin.status !== 200) process.exit(1);
  // Standalone Next can expose its internal listener in request.url. The
  // native app enters through /start, so verify its public redirect too.
  const start = await fetch(`${origin}/start?to=home`, {
    signal: AbortSignal.timeout(5000), redirect: "manual",
    headers: { host: "texttext.app", "x-forwarded-proto": "https" },
  });
  const destination = new URL(start.headers.get("location") || "/", "https://texttext.app");
  if (start.status !== 307 || destination.origin !== "https://texttext.app" || destination.pathname !== "/signin") process.exit(1);
} catch { process.exit(1); }
CHECK
  then healthy=1; break; fi
  sleep 2
done
[ "$healthy" = 1 ] || { echo "New TextText build did not pass health checks." >&2; exit 1; }
sudo -n /usr/bin/node "$release/release/oracle/smoke.mjs" --scratch --env-file /etc/texttext/runtime.env --origin http://127.0.0.1:3400

# Cut over the reviewed daily unit only after the new application has passed its
# authenticated smoke. Preserve the prior unit until daemon-reload succeeds so
# a failed cutover can restore both the application and its matching backup unit.
sudo -n test ! -e "$backup_unit_new"
sudo -n test ! -e "$backup_unit_previous"
if sudo -n test -e "$backup_unit"; then
  sudo -n cp --archive --reflink=auto "$backup_unit" "$backup_unit_previous"
  backup_unit_had_previous=1
fi
sudo -n install -o root -g root -m 0644 "$backup_unit_rendered" "$backup_unit_new"
backup_unit_replaced=1
sudo -n mv -Tf "$backup_unit_new" "$backup_unit"
sudo -n systemctl daemon-reload
sudo -n cmp --silent "$backup_unit_rendered" "$backup_unit"
sudo -n systemctl cat texttext-backup.service >/dev/null
sudo -n systemctl reset-failed texttext-backup.service
trap - EXIT
backup_unit_replaced=0
if [ "$backup_unit_had_previous" = 1 ]; then
  sudo -n rm "$backup_unit_previous" || echo "The retired backup unit remains at $backup_unit_previous." >&2
fi
echo "Oracle TextText is serving $expected. Previous release retained."
REMOTE
