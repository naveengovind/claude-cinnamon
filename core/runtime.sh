# Cinnamon runs its own scripts (the cinnamon command, render.cjs, cdp.mjs) with Bun.
# (The code that runs inside Claude uses Claude's own runtime.)
# Usage: . core/runtime.sh; bun=$(cinnamon_bun)
cinnamon_bun() {
  command -v bun && return
  for b in /opt/homebrew/bin/bun /usr/local/bin/bun "$HOME/.bun/bin/bun"; do
    [ -x "$b" ] && { echo "$b"; return; }
  done
}
