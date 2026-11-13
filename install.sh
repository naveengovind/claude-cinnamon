#!/bin/sh
# Installs Cinnamon (themes and extensions for the Claude desktop app, macOS) as one standalone `cinnamon` command:
# Bun and everything else are inside it, so neither Homebrew nor Bun is needed. Then runs `cinnamon install`, which
# sets up the login item that applies Cinnamon each time Claude starts.
#
#   While the repository is private (needs the GitHub CLI, signed in):
#     gh api -H 'Accept: application/vnd.github.raw' repos/naveengovind/claude-cinnamon/contents/install.sh | sh
#   Once it is public:
#     curl -fsSL https://raw.githubusercontent.com/naveengovind/claude-cinnamon/main/install.sh | sh
#
# CINNAMON_BIN_DIR: where the command goes (default ~/.local/bin). CINNAMON_RELEASE: a release tag (default: latest).
set -eu

repo=naveengovind/claude-cinnamon
[ "$(uname -s)" = Darwin ] || { echo "Cinnamon is for macOS."; exit 1; }
# hw.optional.arm64 is 1 on Apple silicon, even in a shell running under Rosetta
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; else arch=x64; fi
asset="cinnamon-darwin-$arch.tar.gz"
dest="${CINNAMON_BIN_DIR:-$HOME/.local/bin}"
tag="${CINNAMON_RELEASE:-}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Cinnamon ($arch)…"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  # shellcheck disable=SC2086 # an empty $tag means the latest release
  gh release download $tag --repo "$repo" --pattern "$asset" --pattern SHA256SUMS --dir "$tmp" ||
    { echo "Download failed."; exit 1; }
else
  if [ -n "$tag" ]; then base="https://github.com/$repo/releases/download/$tag"; else base="https://github.com/$repo/releases/latest/download"; fi
  if ! curl -fsSL -o "$tmp/$asset" "$base/$asset" || ! curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"; then
    echo "Download failed. While the repository is private, install the GitHub CLI and sign in first: gh auth login"
    exit 1
  fi
fi

want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")
got=$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')
if [ -z "$want" ] || [ "$want" != "$got" ]; then
  echo "The download does not match the release checksum; nothing was installed."
  exit 1
fi

tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$dest"
cp "$tmp/cinnamon" "$dest/cinnamon.new"
chmod 755 "$dest/cinnamon.new"
mv -f "$dest/cinnamon.new" "$dest/cinnamon"
xattr -d com.apple.quarantine "$dest/cinnamon" 2>/dev/null || true
echo "Installed Cinnamon $("$dest/cinnamon" --version) to $dest/cinnamon"

"$dest/cinnamon" install

if ! command -v cinnamon >/dev/null 2>&1; then
  echo
  echo "To use the cinnamon command, add $dest to your PATH:"
  echo "  echo 'export PATH=\"$dest:\$PATH\"' >> ~/.zshrc"
fi
