#!/bin/bash
# One-time setup on Richard's Mac. Run in Terminal:
#   bash <(curl -fsSL https://raw.githubusercontent.com/richardmcallister-personal/ledzeppelin/main/tools/discogs-mac/install.sh)
# Asks for the Discogs personal token (the same one saved on the Worker), stores it in ~/.config/ledzeppelin-discogs
# (readable only by you), and schedules refresh.sh every 5 hours with launchd. Re-run to update; uninstall.sh removes it.
set -euo pipefail
DIR="$HOME/.config/ledzeppelin-discogs"
RAW="https://raw.githubusercontent.com/richardmcallister-personal/ledzeppelin/main/tools/discogs-mac"
LABEL="app.ledzeppelin.discogs"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod 700 "$DIR"
if [ ! -s "$DIR/token" ]; then
  read -r -s -p "Paste your Discogs personal access token (input hidden), then press Return: " T; echo
  [ -n "$T" ] || { echo "No token entered."; exit 1; }
  umask 077; printf '%s' "$T" > "$DIR/token"; unset T
fi
chmod 600 "$DIR/token"
curl -fsSL "$RAW/refresh.sh" -o "$DIR/refresh.sh"; chmod 700 "$DIR/refresh.sh"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/refresh.sh</string></array>
  <key>StartInterval</key><integer>18000</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/ledzeppelin-discogs.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/ledzeppelin-discogs.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. First refresh is running now (about 90 seconds)."
echo "Log: ~/Library/Logs/ledzeppelin-discogs.log   Check: https://ledzeppelin.app/health"
