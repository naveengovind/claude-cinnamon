# Cinnamon's JavaScript runtime for its local scripts (the cinnamon command, render.cjs, cdp.mjs):
# $CINNAMON_RUNTIME, else "runtime" in config.json ("node" or "bun"), else node, else bun.
# (The code that runs inside Claude uses Claude's own runtime either way.)
# Usage: . core/runtime.sh; js=$(cinnamon_js "$USER_DIR")
cinnamon_js() {
  want="${CINNAMON_RUNTIME:-}"
  if [ -z "$want" ] && [ -f "$1/config.json" ]; then
    want=$(sed -n 's/.*"runtime"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' "$1/config.json" | head -n 1)
  fi
  bun_path() { command -v bun || { [ -x "$HOME/.bun/bin/bun" ] && echo "$HOME/.bun/bin/bun"; }; }
  case "$want" in
    bun) bun_path ;;
    node) command -v node ;;
    *) command -v node || bun_path ;;
  esac
}
