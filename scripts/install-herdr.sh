#!/bin/sh
# Copies the herdr pane (to-tickets/herdr/tickets) into herdr's mods folder, where herdr reloads open boards when a file changes.
# With --watch (macOS), also adds a launchd agent that runs this again whenever one of the files is saved.
set -e
cd "$(dirname "$0")/.."
src=$(pwd)/to-tickets/herdr/tickets
dest=$HOME/.config/herdr-app/mods/tickets
files="main.js tickets.js mod.json"
# herdr does not reload through a symlinked folder, so the mod is a real folder.
if [ -L "$dest" ]; then rm "$dest"; fi
mkdir -p "$dest"
for f in $files; do
  cmp -s "$src/$f" "$dest/$f" || cp "$src/$f" "$dest/$f"
done
[ "$1" = --watch ] || exit 0

label=ticket-board.herdr-mod
plist=$HOME/Library/LaunchAgents/$label.plist
# The folder catches editors that replace a file on save, the files catch writes in place.
{
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$(pwd)/scripts/install-herdr.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>1</integer>
  <key>WatchPaths</key><array>
    <string>$src</string>
EOF
  for f in $files; do echo "    <string>$src/$f</string>"; done
  echo "  </array>"
  echo "</dict></plist>"
} > "$plist"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null && sleep 1
launchctl bootstrap "gui/$(id -u)" "$plist"
