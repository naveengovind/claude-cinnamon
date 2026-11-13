# Cinnamon

Themes and extensions for the **Claude desktop app on macOS**, in the spirit of Spicetify.
Not affiliated with or endorsed by Anthropic.

- **Colour schemes** picked in Claude's own *Settings → Appearance → Color scheme*: Codex (neutral near-black),
  Glass (see-through, blurred desktop behind), or any theme you write as a small JSON file.
- **Extensions**, switched on and off in *Settings → Appearance → Extensions*:
  - **Sidebar cards**: t3-style session cards with folder, branch, model and age, a live *Working* timer, the app's
    status (Needs you / Blocked / Failed / Review) and your own labels (To do / In progress / Done).
  - **Full width**: adds *Full* to *Settings → Appearance → Transcript width*.
  - Install more from GitHub: `cinnamon ext install owner/repo`.
- **Re-applies itself every time Claude starts.** Claude.app itself is never modified.

## Requirements

- macOS 13 or later, and the Claude desktop app in `/Applications`
- Developer Mode in Claude: *Help → Troubleshooting → Enable Developer Mode*
- git, to install themes and extensions from GitHub

That is all: Cinnamon is a single standalone command with [Bun](https://bun.sh) and its prebuilt helper inside.

## Install

```sh
gh api -H 'Accept: application/vnd.github.raw' repos/naveengovind/claude-cinnamon/contents/install.sh | sh
```

While the repository is private this needs the [GitHub CLI](https://cli.github.com), signed in (`gh auth login`).
Once it is public: `curl -fsSL https://raw.githubusercontent.com/naveengovind/claude-cinnamon/main/install.sh | sh`.

The script downloads the build for your Mac (Apple silicon or Intel) from the latest release, checks it against the
release's `SHA256SUMS`, puts the `cinnamon` command in `~/.local/bin` (`CINNAMON_BIN_DIR` picks another folder) and
runs `cinnamon install`. Later: `cinnamon update`.

`cinnamon install` sets up **Cinnamon Helper**, adds it as a login item, links the `cinnamon` command into your PATH and
applies Cinnamon if Claude is running. macOS will ask you to allow two things for Cinnamon Helper:

- **Accessibility** (*System Settings → Privacy & Security → Accessibility*), so it can click Claude's
  *Developer → Enable Main Process Debugger* menu item at launch;
- **controlling Google Chrome**, so it can close the `chrome://inspect` tab Claude opens whenever its debugger
  turns on.

## Use

In Claude: *Settings → Appearance* has two new rows, **Color scheme** and **Extensions** (tagged *Cinnamon*).

From the terminal:

| Command | |
| --- | --- |
| `cinnamon status` | what is installed and applied |
| `cinnamon theme` / `cinnamon theme <id>` | list themes / use one (`default` = Claude's own colours) |
| `cinnamon theme install <source>` / `cinnamon theme remove <id>` | add themes from GitHub, git or a folder / remove one |
| `cinnamon ext` / `cinnamon ext enable\|disable <id>` | list extensions / switch one |
| `cinnamon ext install <source>` / `cinnamon ext remove <id>` | add / remove an extension |
| `cinnamon apply` | apply now (Cinnamon Helper does it, so your terminal needs no extra permission) |
| `cinnamon doctor` / `cinnamon logs` | check the setup / the helper's log |
| `cinnamon update` | upgrade to the latest release and refresh the setup |
| `cinnamon uninstall` | remove the login item (Claude is back to normal at its next launch); then delete the `cinnamon` command (it says where) |
| `cinnamon version` | Cinnamon's version |

`<source>` is `owner/repo`, `https://github.com/owner/repo[/tree/<branch>/<folder>]`, any git URL or a local folder,
optionally followed by `#<folder>`. Private repos work with your normal git credentials.

Your settings live in `~/.config/claude-cinnamon/`: `config.json`, `themes/`, `extensions/`, `data/`, `logs/`, and
the built helper (`helper/`, kept here so upgrades don't make macOS ask for its permission again).
Changes to any of them apply to a running Claude within a second. (Turning off an extension that has page code
reloads Claude's window, since page code can't be taken out of a running page.)

## Themes

A theme is one JSON file in `~/.config/claude-cinnamon/themes/` (or `themes/` here):

```json
{
  "name": "Dusk",
  "description": "Blue-grey",
  "dark":  { "background": "#101018", "sidebar": "#14141d", "popover": "#22222e", "text": "#f2f2f7" },
  "light": { "background": "#fbfbfd" }
}
```

A section per mode (`dark`, `light`); a missing section or key keeps Claude's own colour. Values are CSS colours:
hex, names, or colour functions (`rgb`, `hsl`, `oklch`, `color-mix`, `var`, `calc`, `light-dark`…).

| Key | Colours |
| --- | --- |
| `background`, `background-deep`, `frame` | the chat area, the deepest wells, the frame behind the main area |
| `sidebar`, `text-sidebar` | the sidebar and its text |
| `raised`, `panel`, `popover` | dialogs and raised cards, panels, dropdowns / menus / the message box |
| `code-background` | terminal, changes and files panels, code blocks |
| `text`, `text-secondary`, `text-muted`, `placeholder` | text levels |
| `border`, `border-faint`, `hover`, `selected`, `selected-hover` | lines and row states |
| `button`, `button-hover`, `button-text`, `button-secondary`, `button-secondary-hover` | buttons |
| `accent`, `accent-hover`, `danger`, `text-danger`, `success`, `text-success` | accents |

Also:
- `"vars": { "--cds-…": "…" }` inside a mode sets any of the app's CSS variables directly;
- `"css": "…"` adds extra CSS. So that a theme can never load or report anything elsewhere, it may not use
  backslash escapes, `@import`, `@font-face`, `image-set()`/`image()`/`cross-fade()`, or `url()` except `data:` URLs;
- `"window": { "vibrancy": "under-window" }` gives the window a macOS glass material while the theme is on (see
  `themes/glass.json`); Claude's own material comes back when you switch away.

## Extensions

An extension is a folder with a `manifest.json`:

```json
{ "id": "zen", "name": "Zen mode", "description": "…", "version": "1.0.0", "page": ["zen.ts"], "css": ["zen.css"] }
```

`page` scripts (TypeScript or JavaScript; Cinnamon compiles TypeScript with Bun) run in Claude's window each time it
loads, with a `cinnamon` object (types: `types/cinnamon.d.ts`):

```ts
cinnamon.settings.get('key');            // this extension's settings (saved in config.json)
cinnamon.settings.set('key', value);
cinnamon.settings.onChange((all) => …);
```

Built-in extensions may also have a `main` part (`.ts` or `.cjs`) that runs in Claude's main process (the sidebar
cards use one to read session files). Extensions installed from elsewhere run in the page only: a `main` entry is
ignored, and their TypeScript may only import files inside the extension.

## How it works

Claude.app is signed and its code archive is integrity-checked, so Cinnamon never edits it. Instead:

1. **Cinnamon Helper**, a small login item, watches for Claude to start and clicks Claude's own
   *Developer → Enable Main Process Debugger* (that's why it needs Accessibility, and why Developer Mode is needed).
2. Cinnamon bundles its main-process code (`core/main`, TypeScript) with Bun, connects to that debugger on
   `127.0.0.1:9229`, runs the bundle inside Claude's main process, then turns the debugger off again. It refuses to
   touch the port if another process owns it.
3. From then on, for the rest of that Claude session, the main-process code puts the theme CSS and the extensions into
   Claude's window on every load (compiling extension TypeScript with Bun as needed), and watches your config, themes
   and extensions for changes.

It is built to survive app updates: it hooks onto the app's CSS variables, ARIA roles and visible labels, never
generated class names, and every hook is optional, so if a future version moves something, that one feature quietly
switches off instead of breaking Claude. `cinnamon doctor` checks the setup (Bun, the helper, its permission,
Developer Mode at the last launch, the last apply, broken themes or extensions).

## Development

Everything is TypeScript run by [Bun](https://bun.sh) (the helper is Swift, styles are CSS).

```sh
git clone https://github.com/naveengovind/claude-cinnamon && cd claude-cinnamon
bun install
bun test               # bun:test + jsdom
bun run typecheck      # strict tsc: main-process/CLI code and page code
bin/cinnamon install   # points the login item at this checkout (the standalone's `cinnamon install` points it back)
bun scripts/build.ts   # the standalone builds: dist/cinnamon-darwin-{arm64,x64}.tar.gz + SHA256SUMS (--arch=arm64: one)
bun scripts/release.ts # checks, builds, tags v<package.json version> and creates the GitHub release
```

The standalone binary (`bun build --compile`) carries Bun, the files below and a universal, signed Cinnamon Helper.
Each version unpacks them into `~/.config/claude-cinnamon/app/<version>` on first run and runs from there, using
itself wherever Cinnamon would run Bun (`cinnamon __compile` compiles extension TypeScript for Claude). A checkout
run with `bin/cinnamon` needs Bun and the Xcode Command Line Tools (to build the helper) instead.

| Folder | |
| --- | --- |
| `core/main/` | runs inside Claude's main process: `Cinnamon` (orchestrator), `ViewManager`, `ThemeApplier`, `ExtensionHost`, `ExtensionContext`, `Compiler`, `PageChannel`, `FileWatcher`, `WindowMaterial`, `SerialQueue` |
| `core/page/` | runs in Claude's window: `CinnamonRuntime` (the `cinnamon` API), `SettingsRows` / `RowMenu` (Settings → Appearance rows) |
| `core/lib/` | shared: `ThemeEngine`, `ThemeStore`, `Config`, `ExtensionCatalog` |
| `core/apply/` | applying: `Applier`, `AutoApplier` (what the helper runs at each launch), `LockFile`, `System`, the Chrome-tab script |
| `core/cli/` | the `cinnamon` command: `Cli`, `ThemeCommands`, `ExtensionCommands`, `SourceFetcher`, `HelperClient`, `Doctor`, `Updater` (standalone updates), `Compile` (`cinnamon __compile`) |
| `core/install/` | `Installer` (helper build or prebuilt copy, login item, PATH link) |
| `core/standalone/` | the standalone binary: `runStandalone` (entry), `Payload` (unpacks its files per version) |
| `scripts/`, `install.sh` | standalone build and release; the install script |
| `core/render.ts`, `core/InspectorClient.ts` | bundles the main-process code; talks to Claude's debugger |
| `core/helper/` | Cinnamon Helper (Swift) |
| `extensions/`, `themes/` | built-in extensions and themes |
| `types/cinnamon.d.ts` | the `cinnamon` API for extension page code |
| `test/` | tests |
| `tools/` | probes for exploring the app (`bun core/InspectorClient.ts <file>` while the debugger is on) |
