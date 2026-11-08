#!/bin/bash
# Removes the Discogs refresh job and the stored token from this Mac.
LABEL="app.ledzeppelin.discogs"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/.config/ledzeppelin-discogs"
echo "Removed. The site falls back to Discogs links within 5.5 hours."
