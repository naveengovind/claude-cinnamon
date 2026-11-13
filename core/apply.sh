#!/bin/bash
# Apply Cinnamon (themes + extensions) to the running Claude desktop app.
# Uses the app's own Developer > Enable Main Process Debugger (needs Developer Mode on): Cinnamon Helper presses it,
# this script loads core/main.js.tmpl into Claude's main process, then turns the debugger off again — even if
# applying fails — unless --keep is given. Cinnamon stays applied (including across in-app reloads) until Claude
# quits; the login helper (cinnamon install) runs this again at every launch.
# Only one apply runs at a time (state/apply.lock); a caller that already holds the lock sets CM_LOCK_HELD=1.
set -euo pipefail
DIR="${CM_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"            # the Cinnamon checkout
USER_DIR="${CINNAMON_HOME:-$HOME/.config/claude-cinnamon}"    # your config, themes, extensions, data
STATE="${CM_STATE:-$USER_DIR/state}"
HELPER="${CM_HELPER:-$DIR/build/Cinnamon Helper.app/Contents/MacOS/cinnamon-helper}"
PRESS_TIMEOUT="${CM_PRESS_TIMEOUT:-60}"
PORT=9229
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
script=""; chrome=""; front=""; closer=""; locked=0; claude=""

listener() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

take_lock() {
  local lock="$STATE/apply.lock" waited=0 holder
  mkdir -p "$STATE"
  until mkdir "$lock" 2>/dev/null; do
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -z "$holder" ] || ! kill -0 "$holder" 2>/dev/null; then rm -rf "$lock"; continue; fi   # left by a run that died
    if [ "$waited" -ge "${CM_LOCK_WAIT:-90}" ]; then echo "Another apply is still running (pid $holder); try again in a moment."; return 1; fi
    sleep 1; waited=$((waited + 1))
  done
  echo $$ > "$lock/pid"
  locked=1
}

# Turning the debugger on makes Claude run `open -a "Google Chrome" chrome://inspect`. Runs in the background
# from the moment of the press: closes that tab as soon as it appears and brings the previous app back.
close_chrome_tab() {
  echo "chrome: $(osascript -l JavaScript "$DIR/core/chrome-tab.js" cleanup "$chrome" 2>&1 || true)"
  if [ -n "$front" ] && [ -x "$HELPER" ]; then "$HELPER" activate "$front" >/dev/null 2>&1 || true; fi
}

cleanup() {
  [ -n "$script" ] && rm -f "$script"
  # only ever close Claude's own inspector — first, so it is never left on while waiting for anything else
  if [ "$KEEP" = 0 ] && [ -n "$claude" ] && [ "$(listener)" = "$claude" ]; then
    local close
    close=$(mktemp -t claude-mod-close).js
    # also clear the menu's checkmark, which Claude only updates when the item itself is clicked
    cat > "$close" <<'JS'
require('inspector').close();
try {
  const walk = (m) => m && m.items.forEach((i) => { if (i.label === 'Enable Main Process Debugger') i.checked = false; walk(i.submenu); });
  walk(require('electron').Menu.getApplicationMenu());
} catch {}
'closed'
JS
    node "$DIR/core/cdp.mjs" "$close" >/dev/null 2>&1 || true
    rm -f "$close"
  fi
  [ -n "$closer" ] && wait "$closer" 2>/dev/null
  [ "$locked" = 1 ] && rm -rf "$STATE/apply.lock"
  return 0
}
trap cleanup EXIT

claude=$(pgrep -u "$(id -u)" -x Claude | head -1 || true)
if [ -z "$claude" ]; then echo "Claude is not running"; exit 1; fi
[ -n "${CM_LOCK_HELD:-}" ] || take_lock

owner=$(listener)
if [ -n "$owner" ] && [ "$owner" != "$claude" ]; then
  echo "Port $PORT is in use by another process (pid $owner), not Claude (pid $claude); not applying."
  exit 1
fi

if [ -z "$owner" ]; then
  if [ ! -x "$HELPER" ]; then echo "Cinnamon Helper isn't built yet; run: cinnamon install"; exit 1; fi
  chrome=$(osascript -l JavaScript "$DIR/core/chrome-tab.js" snapshot || true)
  front=$("$HELPER" front 2>/dev/null || true)
  "$HELPER" press "$claude" --timeout "$PRESS_TIMEOUT"
  close_chrome_tab &
  closer=$!
  [ -n "$front" ] && echo "front app before the press: pid $front"
  for _ in $(seq 1 40); do owner=$(listener); [ -n "$owner" ] && break; sleep 0.25; done
  if [ "$owner" != "$claude" ]; then
    echo "Claude's debugger did not come up on port $PORT (listener: ${owner:-none})."
    exit 1
  fi
fi

script=$(mktemp -t claude-mod).js
node "$DIR/core/render.cjs" "$DIR" > "$script"
node "$DIR/core/cdp.mjs" "$script"

mkdir -p "$STATE"
printf '%s %s\n' "$claude" "$(ps -o lstart= -p "$claude" | sed 's/^ *//')" > "$STATE/applied"
