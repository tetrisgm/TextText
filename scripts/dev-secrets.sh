#!/usr/bin/env bash
# Development AI credentials live in the macOS login Keychain, never in a file.
#
#   service: texttext-dev-anthropic   account: api-key   (Anthropic / Claude)
#   service: texttext-dev-openai      account: api-key   (OpenAI)
#
# This mirrors release/secrets.sh: values are read through `security`, never
# passed as a command argument (so they cannot appear in `ps`), never echoed,
# and never written to a log. A missing key is reported by name only.
#
# Store or rotate one without it touching your shell history or an agent's
# context (copy the key from the provider console first):
#
#   security add-generic-password -U -a api-key -s texttext-dev-anthropic -w "$(pbpaste)"
#   security add-generic-password -U -a api-key -s texttext-dev-openai    -w "$(pbpaste)"
#
# Get a key: https://console.anthropic.com/settings/keys
#            https://platform.openai.com/api-keys

dev_secret() {
  security find-generic-password -w -a api-key -s "$1" 2>/dev/null
}

# Export the first configured provider's key as the workspace expects it.
# Prints which provider was chosen (to stderr) and nothing about the value.
load_dev_ai_key() {
  local anthropic openai
  anthropic="$(dev_secret texttext-dev-anthropic)"
  openai="$(dev_secret texttext-dev-openai)"
  if [ -n "$anthropic" ]; then
    export TEXTTEXT_DEV_AI_PROVIDER="anthropic"
    export TEXTTEXT_DEV_AI_KEY="$anthropic"
    echo "dev AI: anthropic key loaded from Keychain" >&2
  elif [ -n "$openai" ]; then
    export TEXTTEXT_DEV_AI_PROVIDER="openai"
    export TEXTTEXT_DEV_AI_KEY="$openai"
    echo "dev AI: openai key loaded from Keychain" >&2
  else
    echo "No dev AI key in the Keychain (texttext-dev-anthropic or texttext-dev-openai)." >&2
    echo "See scripts/dev-secrets.sh for how to store one." >&2
    return 1
  fi
}
