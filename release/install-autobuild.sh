#!/bin/bash
# Install the Texttext autobuild daemon as a per-user launchd agent so it runs at
# login and keeps itself alive. Idempotent: safe to re-run (reloads).
set -euo pipefail

LABEL="net.writeapp.write.autobuild"
REPO="$HOME/dev/write"
SCRIPT="$REPO/release/autobuild.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

chmod +x "$SCRIPT"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$REPO/release/.autobuild.out.log</string>
  <key>StandardErrorPath</key><string>$REPO/release/.autobuild.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.npm-global/bin</string>
  </dict>
</dict>
</plist>
PLISTEOF

UID_NUM=$(id -u)
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl enable "gui/$UID_NUM/$LABEL" 2>/dev/null || true
echo "Installed + loaded $LABEL"
launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null | grep -E "state =|program =" | head -3 || true
