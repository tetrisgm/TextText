#!/usr/bin/env bash
# Release credentials live in the macOS login Keychain, not in a plaintext file.
#
#   service: texttext-release
#   accounts: DATABASE_URL (production Neon), BLOB_READ_WRITE_TOKEN
#
# Read one with `release_secret NAME`. Values are never passed as command
# arguments (so they cannot appear in `ps`), never echoed, and never written to
# a log. Store or rotate one with:
#
#   release/secrets.sh store DATABASE_URL      # prompts, input hidden
#
# Notarization keeps using its own notarytool Keychain profile
# (TEXTTEXT_NOTARY_PROFILE), which is already the correct storage.

RELEASE_KEYCHAIN_SERVICE="${RELEASE_KEYCHAIN_SERVICE:-texttext-release}"

release_secret() {
  local name="$1"
  security find-generic-password -w \
    -s "$RELEASE_KEYCHAIN_SERVICE" -a "$name" 2>/dev/null
}

# Export a secret into the environment, failing loudly when it is missing so a
# release stops rather than silently targeting the wrong database or bucket.
require_release_secret() {
  local name="$1" value
  value="$(release_secret "$name")"
  if [ -z "$value" ]; then
    echo "Missing release secret '$name' in the login Keychain." >&2
    echo "Store it once with: release/secrets.sh store $name" >&2
    return 1
  fi
  export "$name=$value"
}

release_secrets_store() {
  local name="${1:-}" value
  if [ -z "$name" ]; then
    echo "usage: release/secrets.sh store <NAME>" >&2
    return 2
  fi
  printf 'Value for %s (input hidden): ' "$name" >&2
  IFS= read -rs value
  printf '\n' >&2
  [ -n "$value" ] || { echo "Refusing to store an empty value." >&2; return 1; }
  # Piped through `security -i` so the secret never lands in argv.
  printf 'add-generic-password -U -a %s -s %s -w %s\n' \
    "$name" "$RELEASE_KEYCHAIN_SERVICE" "$value" | security -i
  echo "Stored $name in the login Keychain (service $RELEASE_KEYCHAIN_SERVICE)." >&2
}

# Allow direct invocation for storing and rotating, while still being sourceable.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    store) shift; release_secrets_store "$@" ;;
    *) echo "usage: release/secrets.sh store <NAME>" >&2; exit 2 ;;
  esac
fi
