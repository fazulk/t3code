#!/usr/bin/env bash
#
# Installs T3 Code from the release DMG into /Applications.
#
# Usage: ./scripts/install-mac-app.sh
#
set -euo pipefail

DMG="/Users/jeff.f/webz/t3code/release/T3-Code-0.0.20-arm64.dmg"

if [[ ! -f "$DMG" ]]; then
  echo "Error: DMG not found at $DMG" >&2
  exit 1
fi

MOUNT_POINT=$(mktemp -d /tmp/t3code-dmg.XXXXXX)

cleanup() {
  echo "Unmounting DMG..."
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  rmdir "$MOUNT_POINT" 2>/dev/null || true
}
trap cleanup EXIT

echo "Mounting $DMG..."
hdiutil attach "$DMG" -mountpoint "$MOUNT_POINT" -nobrowse -quiet

# Find the .app bundle inside the mounted DMG
APP=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" -print -quit)

if [[ -z "$APP" ]]; then
  echo "Error: No .app bundle found in the DMG." >&2
  exit 1
fi

APP_NAME=$(basename "$APP")
APP_BASENAME="${APP_NAME%.app}"
DEST="/Applications/$APP_NAME"

# Quit the running app (if any) so we can replace it and relaunch a fresh copy.
if pgrep -f "/Applications/$APP_NAME/Contents/MacOS/" >/dev/null 2>&1; then
  echo "Quitting running $APP_BASENAME..."
  osascript -e "tell application \"$APP_BASENAME\" to quit" 2>/dev/null || true

  # Wait up to 10s for it to exit gracefully
  for _ in $(seq 1 20); do
    if ! pgrep -f "/Applications/$APP_NAME/Contents/MacOS/" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  # Force kill any stragglers
  pkill -f "/Applications/$APP_NAME/Contents/MacOS/" 2>/dev/null || true
  sleep 1
fi

if [[ -d "$DEST" ]]; then
  echo "Removing existing $DEST..."
  rm -rf "$DEST"
fi

echo "Copying $APP_NAME to /Applications..."
cp -R "$APP" /Applications/

echo "Done! $APP_NAME has been installed to /Applications."

echo "Launching $APP_NAME..."
# -n forces a new instance; -a launches by app path
open -n -a "$DEST"
