#!/bin/bash
# Run by the login helper (Cinnamon Helper) each time Claude starts, with Claude's pid.
# Applies Cinnamon once per Claude process: takes the apply lock (waiting for an apply already running), then skips a
# process apply.sh already recorded, else runs apply.sh with the lock held.
set -uo pipefail
DIR="${CM_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE="${CM_STATE:-${CINNAMON_HOME:-$HOME/.config/claude-cinnamon}/state}"
APPLY="${CM_APPLY:-$DIR/core/apply.sh}"
pid="${1:?usage: autoapply.sh <claude pid>}"

mkdir -p "$STATE"
lock="$STATE/apply.lock"
waited=0
until mkdir "$lock" 2>/dev/null; do
  holder=$(cat "$lock/pid" 2>/dev/null || true)
  if [ -z "$holder" ] || ! kill -0 "$holder" 2>/dev/null; then rm -rf "$lock"; continue; fi   # left by a run that died
  if [ "$waited" -ge "${CM_LOCK_WAIT:-90}" ]; then echo "$(date '+%F %T') another apply is still running (pid $holder); giving up for Claude pid $pid"; exit 0; fi
  sleep 1; waited=$((waited + 1))
done
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT

stamp="$pid $(ps -o lstart= -p "$pid" | sed 's/^ *//')"
if [ "$(cat "$STATE/applied" 2>/dev/null || true)" = "$stamp" ]; then exit 0; fi

echo "$(date '+%F %T') applying to Claude (pid $pid)"
CM_LOCK_HELD=1 bash "$APPLY"
status=$?
echo "$(date '+%F %T') apply finished with status $status"
exit $status
