# Cinnamon

Themes and extensions for the **Claude desktop app on macOS**, in the spirit of Spicetify.
Not affiliated with or endorsed by Anthropic.

- **Color schemes** picked in Claude's own *Settings → Appearance → Color scheme*: Codex (neutral near-black),
  Glass (see-through, blurred desktop behind), Ember (a slow-drifting orange sun and stars behind see-through
  panels), or any theme you write as a small JSON file.
- **Extensions**, switched on and off in *Settings → Appearance → Extensions*:
  - **Sidebar cards**: t3-style session cards with folder, branch, model and age, and a live *Working* timer, for
    every Code session: on this Mac, over SSH and in the cloud (a cloud session shows where it runs). *Working*
    follows the app's own Running status, so it's right for all three.
  - **Full width**: adds *Full* to *Settings → Appearance → Transcript width*.
  - **UFO critter** (off until you switch it on): a little pixel alien flying a saucer around the window. It runs
    from your pointer and now and then beams up a passing cow. Clicks pass through.
  - Install more from GitHub: `cinnamon ext install owner/repo`.
- **Re-applies itself every time Claude starts.** Claude.app itself is never modified.
- **Works alongside Claude Code mods.** Claude Code's own [mods](https://code.claude.com/docs/en/plugins/mods/overview)
  can color the Code tab, so Cinnamon hands that part to a small mod it installs (`cinnamon-colors`) and only does
  what mods can't: the rest of the app, glass, full width, the sidebar cards and the Settings rows.

## Requirements

- macOS 13 or later, and the Claude desktop app in `/Applications`
- Developer Mode in Claude: *Help → Troubleshooting → Enable Developer Mode*
- git, to install themes and extensions from GitHub

That is all: Cinnamon is a single standalone command with [Bun](https://bun.sh) and its prebuilt helper inside.

## Install

With [Homebrew](https://brew.sh), the menu bar app and the `cinnamon` command together:

```sh
brew install --cask naveengovind/tap/cinnamon
```

then open **Cinnamon** from Applications: it walks you through the rest. Or just the command:

```sh
brew install naveengovind/tap/cinnamon
cinnamon install
```

(Pick one: the cask and the formula both provide `cinnamon`.)

Without Homebrew:

```sh
curl -fsSL https://raw.githubusercontent.com/naveengovind/claude-cinnamon/main/install.sh | sh
```

The script downloads the build for your Mac (Apple silicon or Intel) from the latest release, checks it against the
release's `SHA256SUMS`, puts the `cinnamon` command in `~/.local/bin` (`CINNAMON_BIN_DIR` picks another folder) and
runs `cinnamon install` for you.

Either way, `cinnamon update` upgrades later (through `brew upgrade` for a Homebrew install).

`cinnamon install` sets up **Cinnamon Helper**, adds it as a login item, makes sure the `cinnamon` command is on your
PATH, puts the `cinnamon-colors` mod and the `cinnamon` skill in `~/.claude/skills/` (see
[Code tab colors](#code-tab-colors) and [Ask Claude to do it](#ask-claude-to-do-it)) and applies Cinnamon if Claude
is running. macOS will ask you to allow two things for Cinnamon Helper:

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
| `cinnamon theme` / `cinnamon theme <id>` | list themes / use one (`default` = Claude's own colors; a first install starts on `ember`) |
| `cinnamon theme install <source>` / `cinnamon theme remove <id>` | add themes from GitHub, git or a folder / remove one |
| `cinnamon ext` / `cinnamon ext enable\|disable <id>` | list extensions / switch one |
| `cinnamon ext install <source>` / `cinnamon ext remove <id>` | add / remove an extension |
| `cinnamon apply` | apply now (Cinnamon Helper does it, so your terminal needs no extra permission) |
| `cinnamon doctor` / `cinnamon logs` | check the setup / the helper's log |
| `cinnamon screenshot [--out f.png] [--width px]` | a picture of Claude's window, taken by Cinnamon inside Claude: no Screen Recording permission, no debugger, works with the window in the background (`"screenshots": false` in config.json turns it off) |
| `cinnamon update` | upgrade to the latest release and refresh the setup |
| `cinnamon uninstall` | remove the login item (Claude is back to normal at its next launch); then remove the command (`brew uninstall cinnamon`, or the `rm` it shows) |
| `cinnamon version` | Cinnamon's version |

`<source>` is `owner/repo`, `https://github.com/owner/repo[/tree/<branch>/<folder>]`, any git URL or a local folder,
optionally followed by `#<folder>`. Private repos work with your normal git credentials.

Your settings live in `~/.config/claude-cinnamon/`: `config.json`, `themes/`, `extensions/`, `data/`, `logs/`, and
the built helper (`helper/`, kept here so upgrades don't make macOS ask for its permission again).
Changes to any of them apply to a running Claude within a second, with no restart. Extensions hot-reload: editing
one's code, or turning it off, swaps it in place when it cleans up after itself (`cinnamon.onDispose`, below; the
built-in ones do). One that doesn't makes Claude's window reload instead, since its page code can't be taken out.

## Menu bar app

Cinnamon.app puts everything above in the menu bar, for anyone who'd rather not use a terminal:

- **The menu**: pick a color scheme, switch extensions on and off, *Apply Now*, *Take Screenshot…*, *Get More Themes
  and Extensions…* (paste `owner/repo` or a GitHub link; it shows what it found before installing), *Open Themes
  Folder* and *Check for Updates*. It follows changes made anywhere else (the CLI, Claude's Settings rows, Claude
  Code) as they happen.
- **Setup and Help**: a checklist of everything Cinnamon needs, each with a button to fix it: Claude itself, Cinnamon
  Helper (*Install*), the Accessibility permission (opens the right place in System Settings), Developer Mode in Claude,
  Chrome's automation prompt explained, and Claude Code's mod and skill. Below it are any problems `cinnamon doctor`
  finds, *Show Log*, *Open Cinnamon at login* and *Uninstall Cinnamon…*. It opens by itself the first time, until
  Cinnamon is set up.
- **Use in a Browser…** (also in Setup): the browsers on this Mac that Cinnamon works with (Chrome, Arc, Brave, Edge,
  Chromium, Vivaldi), each with *Set Up* or *Remove* ([Claude in Chrome](#claude-in-chrome), one browser at a time).
  After *Set Up* it shows the three clicks left to do in that browser, with the folder to load already copied.

Get it either way:

- **No terminal**: download `Cinnamon-app-darwin-arm64.zip` (Apple silicon) or `Cinnamon-app-darwin-x64.zip` (Intel)
  from the [latest release](https://github.com/naveengovind/claude-cinnamon/releases/latest), unzip it, drag
  Cinnamon.app into Applications and open it. The `cinnamon` command is inside; *Install* in the Setup window copies
  it to `~/.local/bin` and sets everything up, so updates never write inside the app.
- **Already have the command**: `cinnamon app install` puts Cinnamon.app in `~/Applications` and opens it
  (`--no-open` to skip that); `cinnamon app uninstall` removes it. A development checkout builds it with the Swift
  compiler.

Cinnamon.app isn't notarized (that needs a paid Apple Developer ID), so the first time you open a downloaded copy
macOS says it can't check it: open *System Settings → Privacy & Security* and click *Open Anyway* (on macOS 14 and
earlier, right-click the app → *Open*). One installed with `cinnamon app install` opens without asking.

The app does everything through the `cinnamon` command (it adds `--json` for the app to read: `cinnamon status
--json`, `theme list --json`, `ext list --json`, `doctor --json`), so the two never disagree. It doesn't replace
Cinnamon Helper, which keeps the Accessibility permission. `Cinnamon --snapshot <folder>` draws the menu and the Setup
window to PNG files (no Screen Recording permission needed), for docs.

## Ask Claude to do it

`cinnamon install` also adds a Claude Code skill, `cinnamon`, so Claude in any Claude Code session on this Mac (the
desktop app's Code tab or the terminal) can change the app you're using: ask it to *make a warm sepia theme*, *add a
clock to the corner*, *turn off the sidebar cards* or *check what's wrong with Cinnamon*. It works through this
install's `cinnamon` command and your folder, checks its work with `cinnamon ext` / `doctor`, writes extensions that
hot-reload, and asks before installing anything from the internet or removing what you made. The skill names this
install's paths and is rewritten on every `cinnamon install` (`cinnamon uninstall` removes it); SSH sessions use
their host's own skills, so they don't get it.

## Themes

A theme is one JSON file in `~/.config/claude-cinnamon/themes/` (or `themes/` here):

```json
{
  "name": "Dusk",
  "description": "Blue-gray",
  "dark":  { "background": "#101018", "sidebar": "#14141d", "popover": "#22222e", "text": "#f2f2f7" },
  "light": { "background": "#fbfbfd" }
}
```

A section per mode (`dark`, `light`); a missing section or key keeps Claude's own color. Values are CSS colors:
hex, names, or color functions (`rgb`, `hsl`, `oklch`, `color-mix`, `var`, `calc`, `light-dark`…).

| Key | Colors |
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
- `"backdrop": { … }` puts a picture, gradient or animated SVG scene behind the conversation. It's written in the
  shapes of Claude Code's theme API, so the same backdrop is drawn by the Claude apps themselves in the Code tab and
  in the Claude mobile app (through the `cinnamon-colors` mod), and by Cinnamon everywhere else. See
  [Code tab colors](#code-tab-colors) and `themes/ember.json` with its `ember.svg`.
- `"window": { "vibrancy": "under-window" }` gives the window a macOS glass material while the theme is on (see
  `themes/glass.json`); Claude's own material comes back when you switch away.
- See-through colors stack: the app paints a color again on layers that cover each other, so a see-through
  `background` *and* `panel` (say) come out darker where they overlap. Tint once (`body` in `css`, as glass.json
  does) and make the rest `transparent`; `cinnamon theme <id>` prints a `note:` for colors that stack. When
  `background` is see-through, Cinnamon clears the strips the app repaints it on around the message box.

## Code tab colors

(and the Claude mobile app)

Claude Code mods can paint the desktop app's Code tab through Claude Code's own theme API, so Cinnamon doesn't do
that part itself. When you pick a color scheme, Cinnamon turns it into the app's color data (with `makeColors`, the
design system's builder that Claude Code ships for mods) and the `cinnamon-colors` mod hands it to the app in each
Code session. While the app paints it, Cinnamon's own colors for what it carries (backgrounds, text, accent, danger,
success) step aside in the Code tab; the rest of the theme (sidebar, menus and popovers, borders, hover, buttons, code
panels, `vars`, `css`) stays Cinnamon's there too, and everywhere else (Chat, Cowork, Settings) Cinnamon paints it
all as before. You pick in one place, *Settings → Appearance → Color scheme*.

- The app builds about a hundred colors from a theme's `background-deep`/`background`/`raised`/`panel`, `text`,
  `text-secondary`, `text-muted`, `accent`, `danger` and `success` (hex colors only), so the Code tab is close to
  the rest of the app rather than identical. The app refuses a theme whose text is too faint, so Cinnamon leaves such
  colors to the app (`cinnamon doctor` lists them). A theme can give its own `makeColors` input as
  `"codeTab": { … }`, or opt out with `"codeTab": false`.
- Themes with a window material (Glass) stay Cinnamon's everywhere: mods can't make the window see-through.
- Only local Code sessions run the mod (the app doesn't hand skills-folder plugins to SSH hosts). Cinnamon checks
  that the colors the app shows are the scheme you picked and paints over them when they aren't, so a change made
  while only SSH sessions are open still shows at once. One exception: switching to *Default* leaves the old Code
  tab colors until a local Code session opens (or use *Remove colors*, below).
- A scheme without a `light` section still gets the app's design-system light colors in the Code tab, a hair
  warmer than stock.
- Without the mod (or in an app too old to paint mod themes), Cinnamon paints the Code tab itself.
- After `cinnamon uninstall`, if the Code tab keeps its colors: Settings in the Code tab, search *code appearance*,
  *Remove colors*.

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
cinnamon.onDispose(() => …);             // undo what you added: observers, timers, listeners, elements
```

Register clean-up with `cinnamon.onDispose` and the extension hot-reloads: save a change to its files and Cinnamon
runs your clean-up and then the new code, in place, without reloading Claude's window. For example:

```ts
const badge = Object.assign(document.createElement('div'), { textContent: 'Hello' });
document.body.append(badge);
const timer = setInterval(() => { /* … */ }, 1000);
cinnamon.onDispose(() => { badge.remove(); clearInterval(timer); });
```

Built-in extensions may also have a `main` part (`.ts` or `.cjs`) that runs in Claude's main process (the sidebar
cards use one to read session files). Extensions installed from elsewhere run in the page only: a `main` entry is
ignored, and their TypeScript may only import files inside the extension.

## Claude in Chrome

The same themes and extensions on **claude.ai in Chrome, Arc, Brave, Edge, Chromium or Vivaldi**, from the same
files, CLI and skill. It's optional and needs no web store:

```sh
cinnamon browser list                      # the browsers on this Mac, and which have Cinnamon
cinnamon browser install --browser arc     # or chrome, brave, edge, chromium, vivaldi (default: Chrome, else the first found)
```

That builds a small extension into `~/.config/claude-cinnamon/browser/extension` and opens the browser's extensions
page (arc://extensions, chrome://extensions, …), where you do two things once: turn on **Developer mode**, then click
**Load unpacked** and pick that folder (its path is on the clipboard). Then claude.ai's *Settings → Appearance* has
the same Color scheme and Extensions rows as the desktop app. (Cinnamon's page code runs from files inside the
extension, so claude.ai's Content-Security-Policy doesn't stand in its way, and no "Allow User Scripts" switch is
needed.)
Run `install --browser <id>` again for each other browser you use; they share the one folder.

- **Live, both ways.** The extension talks to the `cinnamon` command on your Mac (Chrome's native messaging), which
  watches your themes, extensions and config.json: a theme picked in the browser, the desktop app or the CLI shows up
  everywhere, and editing a theme or extension reloads it in place.
- **Updates without clicks.** `cinnamon update` rebuilds the folder, and the extension reloads itself into the new
  version the next time it connects.
- **What differs in a browser.** Extensions with a main part (the sidebar cards) run only in the desktop app; they're
  listed as such. A Glass theme gets a dark ground, since a browser tab can't be see-through. `cinnamon screenshot`
  sees only the desktop app.
- `cinnamon browser status` (and `doctor`) say whether the extension is connected. `cinnamon browser uninstall
  --browser <id>` takes it out of one browser; `cinnamon browser uninstall` (or `--all`) removes the folder and every
  file that lets a browser start Cinnamon (then remove the extension from the browser's extensions page).
- For scripts: `cinnamon browser list --json` prints `{ schema, extensionId, extensionDir, extensionBuilt, default,
  browsers: [{ id, name, installed, registered, extensionsUrl, hostManifest }] }` for every supported browser.

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
bun scripts/release.ts # checks, builds, tags v<package.json version>, creates the GitHub release, updates the tap
bun scripts/formula.ts # prints the Homebrew formula and cask for dist/ (--publish: commits them to naveengovind/homebrew-tap)
```

**Signing.** The build signs with a *Developer ID Application* certificate when this Mac's keychain has one (or the
one `CINNAMON_SIGN_IDENTITY` names), with the hardened runtime and a timestamp, and notarizes and staples the menu bar
app with a notarytool profile (`CINNAMON_NOTARY_PROFILE`, or `cinnamon-notary` when it exists). Set that up once:

```sh
# Xcode → Settings → Accounts → (your team) → Manage Certificates → + → Developer ID Application, then:
xcrun notarytool store-credentials cinnamon-notary --apple-id <you@example.com> --team-id <TEAMID>
bun scripts/release.ts   # build prints: signing: Developer ID Application: …, notarized
```

Without a Developer ID everything is signed ad hoc, and macOS asks people to allow the downloaded app once
(*System Settings → Privacy & Security → Open Anyway*). Switching from ad hoc to Developer ID changes the helper's
signature, so macOS asks for its Accessibility permission once more.

The standalone binary (`bun build --compile`) carries Bun, the files below and a universal, signed Cinnamon Helper.
Each version unpacks them into `~/.config/claude-cinnamon/app/<version>` on first run and runs from there, using
itself wherever Cinnamon would run Bun (`cinnamon __compile` compiles extension TypeScript for Claude). The Homebrew
formula installs that same binary; since Homebrew runs it from a versioned Cellar folder, the login item names
`<prefix>/opt/cinnamon/bin/cinnamon`, which survives upgrades. A checkout
run with `bin/cinnamon` needs Bun and the Xcode Command Line Tools (to build the helper) instead.

| Folder | |
| --- | --- |
| `core/main/` | runs inside Claude's main process: `Cinnamon` (orchestrator), `ViewManager`, `ThemeApplier`, `ExtensionHost`, `ExtensionContext`, `Compiler`, `PageChannel`, `FileWatcher`, `WindowMaterial`, `SerialQueue` |
| `core/page/` | runs in Claude's window: `CinnamonRuntime` (the `cinnamon` API), `SettingsRows` / `RowMenu` (Settings → Appearance rows) |
| `core/lib/` | shared: `ThemeEngine`, `ThemeStore`, `CodeTabLook`, `Config`, `ExtensionCatalog` |
| `core/apply/` | applying: `Applier`, `AutoApplier` (what the helper runs at each launch), `LockFile`, `System`, the Chrome-tab script |
| `core/cli/` | the `cinnamon` command: `Cli`, `ThemeCommands`, `ExtensionCommands`, `SourceFetcher`, `HelperClient`, `Doctor`, `Updater` (standalone updates), `Compile` (`cinnamon __compile`) |
| `core/install/` | `Installer` (helper build or prebuilt copy, login item, PATH link, the colors mod) |
| `core/standalone/` | the standalone binary: `runStandalone` (entry), `Payload` (unpacks its files per version), `Homebrew` (Homebrew installs: stable opt/ path, prefix) |
| `scripts/`, `install.sh` | standalone build, release and Homebrew formula; the install script (no Homebrew) |
| `skill/cinnamon/` | the Claude Code skill `cinnamon install` puts in `~/.claude/skills/cinnamon` (`{{CINNAMON}}`, `{{USER_DIR}}`, `{{ROOT}}` are filled in) |
| `mod/cinnamon-colors/` | the Claude Code mod that paints the Code tab from Cinnamon's theme (`core/lib/CodeTabLook.ts` writes its input; `core/lib/vendor/make-colors.js` is Claude Code's own color builder, unchanged) |
| `core/render.ts`, `core/InspectorClient.ts` | bundles the main-process code; talks to Claude's debugger |
| `core/helper/` | Cinnamon Helper (Swift) |
| `extensions/`, `themes/` | built-in extensions and themes |
| `types/cinnamon.d.ts` | the `cinnamon` API for extension page code |
| `test/` | tests |
| `tools/` | probes for exploring the app (`bun core/InspectorClient.ts <file>` while the debugger is on) |
