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
if [ "$bootstrap" = 1 ] && { [ -e "$root/current" ] || [ -L "$root/current" ]; }; then
  echo "Bootstrap is allowed only before the first application release." >&2
  exit 1
fi
if [ -e "$root/current" ] && [ ! -L "$root/current" ]; then
  echo "Refusing to replace a current directory; expected a release symlink." >&2
  exit 1
fi
mkdir -p "$root/releases" "$root/incoming"
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
if [ -L "$root/current" ]; then previous="$(readlink -f "$root/current")"; fi
case "$previous" in ""|"$root/releases/"*) ;; *) echo "Current release is outside TextText releases." >&2; exit 1 ;; esac

rollback() {
  result=$?
  if [ "$result" -ne 0 ] && [ "$switched" = 1 ]; then
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
  exit "$result"
}
trap rollback EXIT

cd "$incoming"
sha256sum --check release.tar.gz.sha256
mkdir "$release"
tar --extract --gzip --file release.tar.gz --directory "$release" --no-same-owner --no-same-permissions
cd "$release"
/usr/bin/node -e 'const m=require("./oracle-release.json");if(m.platform!==process.platform||m.architecture!==process.arch||m.deploymentId!==process.argv[1])process.exit(1);require("sharp");require("@next/swc-linux-arm64-gnu");' "$expected"
mkdir -p "$release/.texttext/oracle-build/cache" "$root/state"
if [ -n "$previous" ]; then
  # A manual deployment takes one backup before touching the existing schema.
  sudo -n systemctl start texttext-backup.service
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
} catch { process.exit(1); }
CHECK
  then healthy=1; break; fi
  sleep 2
done
[ "$healthy" = 1 ] || { echo "New TextText build did not pass health checks." >&2; exit 1; }
sudo -n /usr/bin/node "$release/release/oracle/smoke.mjs" --scratch --env-file /etc/texttext/runtime.env --origin http://127.0.0.1:3400
trap - EXIT
echo "Oracle TextText is serving $expected. Previous release retained."
REMOTE
