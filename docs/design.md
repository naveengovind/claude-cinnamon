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
- Hybrid with Claude Code mods (Nov 15 2026): what a mod can do, a mod does; Cinnamon covers only what mods can't
  (see "Working alongside Claude Code mods").

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

## Working alongside Claude Code mods (Nov 15 2026)
Claude Code mods (plugins with a hooks module, loaded in every Code session) can draw panes, rewrite tool calls and
paint the desktop app's Code tab through `$.theme.set({ colors })`. They can't reach the Chat tab, Settings, the
sidebar's session list, the transcript's width, page CSS or the window's material. So:
- **The Code tab's colours are a mod's.** `CodeTabLook` maps the picked theme onto `makeColors` anchors (the same
  pairing as `ThemeEngine.TOKENS`: background-deep → surface-0, background → surface-1, raised → surface-2,
  panel → surface-3, text levels, accent/danger/success), drops anchors in a fixed order until the app's contrast
  check passes, and the main process writes the result to `look.json` inside the installed mod
  (`~/.claude/skills/cinnamon-colors/`). The mod polls it every 2 s and calls `$.theme.set` once an app that paints
  themes is attached (`$.session.surfaces()`), and `$.theme.clear` (only for colours it set, remembered in
  `$.store`) when the picked theme has no look (Default, Glass).
- **The handoff is exact.** The app marks the page's root `data-cds-theme="mod-palette"` while a mod palette stands
  (Code tab only). Cinnamon's page code compares a few of the app's variables that Cinnamon never sets
  (`--cds-gray-*`, `--cds-role-*-600`) with the current look's (`CodeTabLook.print`) and, when they match, marks the
  root `data-cinnamon-code-tab="mod"`. The rules for the keys the look carries (`CodeTabLook.KEYS`: the
  backgrounds, text levels, accent, danger, success) carry
  `:not([data-cinnamon-code-tab="mod"], [data-cinnamon-code-tab="mod"] *)`. So Cinnamon steps aside only where the
  app paints the current look, and paints over an older palette the app still holds. Keys the look can't express
  (sidebar, popover, borders, hover, buttons, code panels), `vars` and `css` stay Cinnamon's in the Code tab too. (`@scope` was tried first;
  Chrome's doesn't match the `<html>` root.)
- **Everything else stays Cinnamon's**: themes outside the Code tab and extra theme CSS, Glass (window vibrancy),
  full width, sidebar cards, the Settings rows and page extensions.
- Observed on Claude 5.11492.5 / Claude Code 2.1.325:
  - the app holds the last drawn mod palette for the whole Code tab, SSH sessions included;
  - a set made while no app is attached to that session waits for one;
  - SSH sessions don't get skills-folder plugins (the app leaves those to the host's own `~/.claude/skills`), so
    only local Code sessions run the mod: with only SSH sessions open, a theme change is painted by Cinnamon until
    a local session starts, and a switch to Default leaves the old palette until then (or Settings → *Remove
    colors*);
  - a theme with no light half still gets the design system's own light palette in the Code tab (a hair off stock);
  - a saved mod file reloads in a Desktop session within about 30 s.

## Hot reload (Nov 16 2026)
Extensions' page code is swapped in place when it can be taken out. The page runtime keeps each extension's clean-up
(`cinnamon.onDispose`); when an extension's page code changes or it is turned off, `ExtensionHost.applyTo` asks the
page to dispose it (`__cinnamon.dispose(id)` runs the clean-up newest first, drops its settings listeners and returns
`'cinnamon:disposed'`), then runs the new code. An extension with no clean-up still makes the window reload. CSS
was already swapped in place (new before old is removed). Both built-in extensions register clean-up that removes
everything they added and guards against a frame already queued.

## Claude controls Cinnamon (Nov 16 2026)
`skill/cinnamon` is a Claude Code skill installed into `~/.claude/skills/cinnamon` with this install's command, user
folder and root filled in (`Installer.installSkill`; its SKILL.md carries "Installed by Cinnamon", and a skill of the
same name without it is left alone). It covers the CLI, how to make themes and extensions (themes.md,
extensions.md), and what to ask the user first. So a session can check its own work: `cinnamon theme <id>` and
`doctor` name rejected theme keys and values (`ThemeEngine.problems`), and extension errors from Claude (compile
errors, errors page code throws when it runs) are written by the main process to `state/extension-errors.json`
(page code reports through the `ext-error` page message) and shown by `cinnamon ext` and `doctor`.

## Seeing the app without permissions (Nov 16 2026)
`cinnamon screenshot` asks the Cinnamon running inside Claude for a picture of its window through files: the command
writes `state/requests/<id>.json` (folder 0700, file 0600) and `core/main/RequestServer` (watching the folder, and
polling once a second) answers in `state/responses/<id>.json`, with the PNG beside it. Claude capturing its own window
(`webContents.capturePage`) needs no Screen Recording permission and no debugger; a background window is woken and
repainted first (one capture, `invalidate()`, a pause, then the real one), or the capture would be a stale frame.
Answers are only ever written into the responses folder and are pruned after 10 minutes; ids are checked, unknown
kinds are answered with an error, and `"screenshots": false` in config.json turns it off. The cinnamon skill uses it
to look at every visible change it makes. Any process running as you could also ask for a picture this way; it can
already read Claude's data on disk, so this adds little, and the switch is there for anyone who wants it off.

## Sidebar cards for every session (Nov 16 2026)
Cards go on every Code row (`code:local_…` for this Mac and SSH, `code:session_…` for cloud). Data comes from the
app's session files and Claude Code's log, or, for an SSH session, the copy of its log the app keeps in
`~/.claude/projects/ssh-<id>/` (branch); a session with no file here gets the place the app shows (Cloud, an
environment). *Working* follows the app's own status: the row's `[data-session-status]` / status icon labelled
"Running" (not the pulsing dot, which also marks an unread response), timed from the log's last prompt when there
is one and otherwise from when the app first showed it running (kept in localStorage). The status chips and the
label picker were removed as clutter: the app shows its own status.
