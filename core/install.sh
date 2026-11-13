#!/bin/bash
# Installs Cinnamon's login item: Cinnamon Helper, which re-applies Cinnamon every time Claude starts.
# Usually run as `cinnamon install` / `cinnamon uninstall`.
#   core/install.sh              build the helper if needed, start it now and at every login, link `cinnamon` into PATH
#   core/install.sh --rebuild    force a rebuild of the helper (macOS then asks for Accessibility again)
#   core/install.sh --uninstall  stop the helper, remove the login item and the `cinnamon` link
# Log: ~/.config/claude-cinnamon/logs/helper.log
set -euo pipefail
DIR="${CINNAMON_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"       # the Cinnamon install (a stable path)
USER_DIR="${CINNAMON_HOME:-$HOME/.config/claude-cinnamon}"
# Built into your data folder, not the install: an upgrade replaces the install, and a rebuilt helper would
# make macOS ask for Accessibility again.
APP="$USER_DIR/helper/Cinnamon Helper.app"
EXE="$APP/Contents/MacOS/cinnamon-helper"
LABEL=local.claude-cinnamon.helper
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OLD_LABEL=local.claude-desktop-mods.helper                    # the helper's name before Cinnamon
DOMAIN="gui/$(id -u)"

stop() {
  launchctl bootout "$DOMAIN/$1" 2>/dev/null || true
  for _ in $(seq 1 25); do launchctl print "$DOMAIN/$1" >/dev/null 2>&1 || break; sleep 0.2; done
}

# Where `cinnamon` gets linked: the first of these that is on PATH and writable.
link_dir() {
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
    case ":$PATH:" in *":$d:"*) [ -d "$d" ] && [ -w "$d" ] && { echo "$d"; return; } ;; esac
  done
}

if [ "${1:-}" = "--uninstall" ]; then
  stop "$LABEL"
  rm -f "$PLIST"
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
    [ -L "$d/cinnamon" ] && [ "$(readlink "$d/cinnamon")" = "$DIR/bin/cinnamon" ] && rm -f "$d/cinnamon"
  done
  echo "Removed the login item and the cinnamon command. Claude goes back to normal at its next launch."
  echo "Your settings stay in $USER_DIR. You can also remove Cinnamon Helper from"
  echo "System Settings > Privacy & Security > Accessibility."
  exit 0
fi

. "$DIR/core/runtime.sh"
JS=$(cinnamon_bun || true)
[ -n "$JS" ] || { echo "Cinnamon needs Bun (brew install oven-sh/bun/bun)"; exit 1; }
command -v swiftc >/dev/null || { echo "Cinnamon needs the Swift compiler to build its helper: xcode-select --install"; exit 1; }

# Build only when the helper's source changed (not just its date): a rebuilt helper has a new signature,
# and macOS then asks for Accessibility again.
SRC_HASH=$(cat "$DIR/core/helper/main.swift" "$DIR/core/helper/Info.plist" | shasum -a 256 | cut -d' ' -f1)
BUILT_HASH=$(cat "$USER_DIR/helper/.built-from" 2>/dev/null || true)
# a helper built by an earlier version inside the install: move it (same build, so the permission still holds)
if [ ! -x "$EXE" ] && [ -x "$DIR/build/Cinnamon Helper.app/Contents/MacOS/cinnamon-helper" ] && [ "$(cat "$DIR/build/.built-from" 2>/dev/null)" = "$SRC_HASH" ]; then
  mkdir -p "$USER_DIR/helper"
  mv "$DIR/build/Cinnamon Helper.app" "$APP"
  cp "$DIR/build/.built-from" "$USER_DIR/helper/.built-from"
  BUILT_HASH=$SRC_HASH
fi
if [ ! -x "$EXE" ] || [ "$SRC_HASH" != "$BUILT_HASH" ] || [ "${1:-}" = "--rebuild" ]; then
  echo "Building Cinnamon Helper…"
  mkdir -p "$APP/Contents/MacOS"
  cp "$DIR/core/helper/Info.plist" "$APP/Contents/Info.plist"
  swiftc -O -o "$EXE" "$DIR/core/helper/main.swift"
  codesign --force --sign - --identifier "$LABEL" "$APP"
  echo "$SRC_HASH" > "$USER_DIR/helper/.built-from"
fi

mkdir -p "$USER_DIR/logs" "$USER_DIR/themes" "$USER_DIR/extensions" "$HOME/Library/LaunchAgents"
JS_DIR="$(dirname "$JS")"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$EXE")</string>
    <string>watch</string>
    <string>--bundle-id</string><string>com.anthropic.claudefordesktop</string>
    <string>--run</string><string>$(xml "$DIR/core/autoapply.sh")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$JS_DIR"):/opt/homebrew/bin:/usr/local/bin:$(xml "$HOME")/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CINNAMON_HOME</key><string>$(xml "$USER_DIR")</string>
    <key>CINNAMON_ROOT</key><string>$(xml "$DIR")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$(xml "$USER_DIR/logs/helper.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$USER_DIR/logs/helper.log")</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null || { rm -f "$PLIST"; echo "Could not write a valid login item ($PLIST)."; exit 1; }

# The helper from before Cinnamon (if any) goes; this one replaces it.
if [ -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" ]; then
  stop "$OLD_LABEL"
  rm -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist"
  echo "Removed the old login item ($OLD_LABEL)."
fi

stop "$LABEL"
launchctl bootstrap "$DOMAIN" "$PLIST"

LINK_DIR="$(link_dir || true)"
EXISTING="$(command -v cinnamon || true)"
if [ -n "$EXISTING" ] && [ "$(readlink "$EXISTING" 2>/dev/null || true)" != "$DIR/bin/cinnamon" ]; then
  echo "The cinnamon command is already on your PATH ($EXISTING)."
elif [ -n "$LINK_DIR" ]; then
  ln -sf "$DIR/bin/cinnamon" "$LINK_DIR/cinnamon"
  echo "Linked the cinnamon command into $LINK_DIR."
else
  echo "Add Cinnamon to your PATH to use the cinnamon command:  export PATH=\"$DIR/bin:\$PATH\""
fi
echo "Cinnamon Helper is running and will start at every login."
echo "If macOS asks, allow Cinnamon Helper under System Settings > Privacy & Security > Accessibility."
