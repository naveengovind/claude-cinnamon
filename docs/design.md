# Cinnamon — themes, extensions and a CLI for the Claude desktop app (design)

Spicetify-style modding for the Claude desktop app on macOS, built on what already works here: the login helper
re-applies everything at each launch through the app's own Developer → Enable Main Process Debugger, and nothing in
the app bundle is modified (its asar integrity check rules that out).

## Decisions (from the user)
- Themes are JSON files; a config file picks one; `default` = Claude's own colours. Adding a theme = dropping in a file.
- The theme picker lives in Claude's own Settings → Appearance ("Color scheme" row), not the menu bar.
- Theme colours apply everywhere it makes sense: page, sidebar, dialogs, dropdowns, menus, tabs, fields, buttons.
  Native macOS menus (menu bar, right-click) can't be themed.
- Features like the sidebar cards become extensions; extensions install from GitHub links.
- Downloaded extensions are page-only (page JS + CSS). Only bundled extensions may have a main-process part.
- Packaged as a CLI named `cinnamon`, macOS only, public repo `naveengovind/claude-cinnamon` (private until
  Nov 13 2026), installed with Homebrew (`naveengovind/tap/cinnamon`) or install.sh.
- Robust against future app versions (below).

## Robustness principles
- Hook onto stable meaning, not layout: CSS custom properties (`--cds-*`), `data-*` attributes, ARIA roles and
  visible labels. Never on generated class names or element positions.
- Every hook is optional: if its anchor isn't found, that feature does nothing (no errors thrown into the app, no
  half-applied UI). All injected code is wrapped so a failure can't break Claude.
- Injected UI is re-created when the app re-renders and never fights React for nodes it owns.
- `cinnamon doctor` checks the setup (helper, permission, Developer Mode, last apply, broken themes/extensions).
  Checking each anchor in the running app is a possible addition.
- Nothing on disk inside Claude.app is touched; uninstall = remove the login item.

## Themes
`themes/<id>.json` (bundled) and `~/.config/claude-cinnamon/themes/<id>.json` (user; same id overrides):
```json
{ "name": "Codex", "description": "…",
  "dark":  { "background": "#111111", "sidebar": "#151515", "text": "#fcfcfc", "vars": { "--cds-…": "…" } },
  "light": { … },
  "css": "optional extra CSS" }
```
Named colour keys map to the app's variables (one key → several variables); a missing key keeps Claude's colour;
`vars` sets any variable directly. A mode section that is absent leaves that mode untouched. Values are any CSS
colour; anything containing `;`, `{`, `}` or `<` is rejected so one typo can't break the stylesheet.

Applying: the main process turns the selected theme into CSS and inserts it into every claude.ai view (its own
insertCSS key, separate from the base CSS), re-applied on reload. `config.json` and the theme folders are watched,
so edits and new files apply live. The page tells the main process about a pick by a prefixed console message
(no polling, no IPC changes to the app).

Settings row: cloned from an existing dropdown row on the Appearance page (so it inherits the app's look), placed
after the Theme row, with a small "Cinnamon" tag; its menu lists Default + themes and "Open themes folder". If the
Appearance page or a dropdown row can't be found, no row is added.

## Extensions (next phase)
`extensions/<id>/manifest.json` → `{ name, description, version, page: ["x.js"], css: ["x.css"], main?: "x.cjs" }`.
Bundled: `sidebar-cards` (page + main), `full-width` (CSS). Enabled set in `config.json`. Installed from GitHub
(`cinnamon ext install <url>`) into the user folder at a pinned commit; `main` is refused for downloaded ones.
Settings gets an "Extensions" section with on/off switches.

## CLI (next phase)
`cinnamon install | uninstall | apply | status | doctor | theme [id|list] | ext [list|install <url>|remove|enable|disable]`
Code in the clone (`~/.claude-cinnamon`), user data in `~/.config/claude-cinnamon` (config, themes, extensions,
labels, logs, state). Install script builds the helper and links the CLI into PATH.

## Code layout (TypeScript, Nov 13 2026)
Everything is TypeScript under Bun, object-oriented (see the README's folder table). Code that runs inside Claude
must be plain JavaScript, so: the main-process code is bundled by `core/render.ts` (Bun.build, CommonJS) into one
script whose wrapper captures the debugger's `require` before the first `await` and hands it in; core page code is
bundled for the browser at render time; extension page code and bundled extensions' main parts are compiled inside
Claude by the `Compiler`, which spawns a compiler command from the config (`[bun, 'build']`; the standalone binary
passes `[itself, '__compile']`) on a copy of the extension under `node_modules` (no build-time macros) and refuses any input
outside the extension.

## Distribution (Nov 13 2026)
One standalone binary per Mac architecture (`scripts/build.ts`, `bun build --compile`): Bun, Cinnamon's files and
a universal, ad-hoc-signed Cinnamon Helper inside. Each version unpacks its files into
`~/.config/claude-cinnamon/app/<version>` (temp folder + rename, so a version folder is complete or absent) and
sets `CINNAMON_BIN`, so the `Compiler` runs `cinnamon __compile` instead of `bun build` and the login item runs
`<your folder>/helper/autoapply.sh`, which hands over to the binary. `install` prunes old versions but keeps the
previous one (a running Claude may still be using it). The prebuilt helper is used only when its recorded source
hash matches, and an existing helper built from the same source is kept, so macOS doesn't ask for Accessibility again.
- **Homebrew** (the default): `naveengovind/tap/cinnamon` installs the binary from the GitHub release
  (`scripts/formula.ts` writes the formula from `SHA256SUMS`; `scripts/release.ts` publishes it to the tap).
  Homebrew runs it from `Cellar/cinnamon/<version>`, which an upgrade removes, so `CINNAMON_BIN` names
  `<prefix>/opt/cinnamon/bin/cinnamon`; `cinnamon update` runs `brew upgrade` then the new version's `install`.
  Cinnamon never links into Homebrew's `bin` (that would break `brew link`).
- **install.sh** (no Homebrew): downloads the release tarball, checks `SHA256SUMS`, installs to `~/.local/bin` and
  runs `cinnamon install`; `cinnamon update` then replaces the binary from the latest release (checksum and
  `--version` checked first) and runs the new version's `install`.
