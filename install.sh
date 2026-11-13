#!/bin/bash
# Cinnamon installer. Run from a checkout (./install.sh), or on its own: it clones Cinnamon to
# ${CINNAMON_DIR:-~/.claude-cinnamon} first, then runs `cinnamon install`.
set -euo pipefail
REPO="${CINNAMON_REPO:-https://github.com/naveengovind/claude-cinnamon.git}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

[ "$(uname)" = Darwin ] || { echo "Cinnamon runs on macOS only."; exit 1; }
command -v git >/dev/null || { echo "Cinnamon needs git (xcode-select --install)."; exit 1; }
command -v node >/dev/null || { echo "Cinnamon needs Node.js 22 or newer (brew install node)."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Cinnamon needs Node.js 22 or newer (you have $(node -v))."; exit 1; }
[ -d /Applications/Claude.app ] || echo "Note: Claude.app isn't in /Applications; Cinnamon will apply once it is."

if [ -n "$HERE" ] && [ -x "$HERE/bin/cinnamon" ]; then
  DIR="$HERE"
else
  DIR="${CINNAMON_DIR:-$HOME/.claude-cinnamon}"
  if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only --quiet; else git clone --quiet "$REPO" "$DIR"; fi
fi

exec "$DIR/bin/cinnamon" install
