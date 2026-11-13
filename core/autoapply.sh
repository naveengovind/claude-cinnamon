#!/bin/bash
# Run by Cinnamon Helper each time Claude starts, with Claude's pid (the helper runs `/bin/bash <this file> <pid>`).
# The work is done by core/apply/AutoApplier.ts, under Bun.
root="${CINNAMON_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$root/core/runtime.sh"
bun=$(cinnamon_bun) || true
[ -n "$bun" ] || { echo "Cinnamon needs Bun (brew install oven-sh/bun/bun)"; exit 1; }
exec "$bun" "$root/core/apply/main.ts" autoapply "$@"
