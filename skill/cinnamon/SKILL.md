---
name: cinnamon
description: Customize the Claude desktop app itself with Cinnamon (this Mac's themes-and-extensions tool for Claude). Use when the user wants to change how the Claude app looks or behaves - colors, a theme or color scheme, dark/glass looks, the sidebar session cards, full-width transcripts, or a new extension/plugin/tweak for the app's window - or asks to list, switch, create, install, edit, enable, disable or remove Cinnamon themes or extensions, or to check or repair Cinnamon (doctor, status, logs, apply, update).
---
<!-- Installed by Cinnamon (`cinnamon install`): replaced on every install and removed by `cinnamon uninstall`. -->

# Cinnamon: change the Claude app you are running in

Cinnamon themes and extends the Claude desktop app on this Mac without modifying Claude.app. A login item injects it
each time Claude starts; from then on it watches its folders and applies every change to the running app **within a
second, with no restart**. So to change the app, you change files or run the CLI, then check the result.

- Command: `{{CINNAMON}}` (use this path; `cinnamon` may not be on this session's PATH)
- The user's folder: `{{USER_DIR}}`: `config.json`, `themes/`, `extensions/`, `data/`, `logs/`
- Built-in themes and extensions (read-only examples): `{{ROOT}}/themes/`, `{{ROOT}}/extensions/`
- Extension API types: `{{ROOT}}/types/cinnamon.d.ts`

## Commands

| Command | Does |
| --- | --- |
| `{{CINNAMON}} status` | install, login item, whether Claude is running and Cinnamon is applied, current theme, enabled extensions |
| `{{CINNAMON}} doctor` | checks the setup; each ✗ line says how to fix it |
| `{{CINNAMON}} theme` / `theme <id>` | list themes (`*` = current) / switch (`default` = Claude's own colors) |
| `{{CINNAMON}} theme install <source> --yes` / `theme remove <id>` | add themes from GitHub, git or a folder / remove one |
| `{{CINNAMON}} ext` / `ext enable <id>` / `ext disable <id>` | list extensions / turn one on or off |
| `{{CINNAMON}} ext install <source> --yes` / `ext remove <id> --yes` | add an extension from GitHub, git or a folder / remove one |
| `{{CINNAMON}} screenshot` | a picture of Claude's window as it is now; prints the PNG's path (see "Look at your work") |
| `{{CINNAMON}} logs` | the helper's log (what happened at the last launches) |
| `{{CINNAMON}} apply` | re-inject Cinnamon now (only needed if `status` says it isn't applied) |

`<source>` is `owner/repo`, `https://github.com/owner/repo[/tree/<branch>/<folder>]`, a git URL or a local folder.

## How to work

1. Start with `{{CINNAMON}} status`. If Claude isn't running, changes apply at its next launch. If Cinnamon isn't
   applied, run `{{CINNAMON}} doctor` and follow its fixes; don't work around them.
2. Make the change: a CLI command, or a file in the user's folder (a theme JSON in `themes/`, an extension folder in
   `extensions/`). Never write into `{{ROOT}}` or Claude.app.
3. Check it. `{{CINNAMON}} theme` / `ext` show what's active, and `doctor` lists broken themes and extensions with
   the reason. Then look at it (below) before you say it's done.

## Look at your work

`{{CINNAMON}} screenshot` saves a picture of Claude's window as it is right now and prints the file's path; open that
file with your Read tool to see it. Cinnamon takes it from inside Claude, so it needs no Screen Recording permission,
and it works while the window is in the background. It takes about a second and a half. The file is in Cinnamon's
private folder and is deleted after 10 minutes, so leave it there: don't pass `--out` unless the user asks for a copy.
Take one after every visible change (wait a second after saving, for it to apply), and fix what you see. Look for
unreadable text, dark bands or boxes (see-through themes), overlaps with the app's own controls, and things
off-screen. `--width <px>` sets the size (default 1600); go bigger to check something small.

- It shows whatever the user has open, often a conversation. Don't describe or repeat its contents beyond what the
  check needs, and don't copy it anywhere else.
- If it says there's no answer, Cinnamon isn't running in Claude (`{{CINNAMON}} status`). If it says screenshots are
  turned off, the user did that (`"screenshots": false` in config.json); ask them to look instead.

Settings for extensions live in `config.json` under `"settings": { "<extension id>": { … } }` (e.g. Full width:
`"full-width": { "width": "full" }` or `null`); edits apply live. Prefer the CLI for turning things on and off.

## Making themes and extensions

- **A theme** is one JSON file, `{{USER_DIR}}/themes/<id>.json`, then `{{CINNAMON}} theme <id>`. Keys, rules and
  what reaches the Code tab and the Claude mobile app (its palette and its `backdrop`, written in the shapes of Claude
  Code's theme API): [themes.md](themes.md). For anything see-through (glass, transparency, an animated or
  picture background), read its "See-through themes" section first: stacked see-through colors are what leave
  dark bands around the message box.
- **An extension** is a folder `{{USER_DIR}}/extensions/<id>/` with `manifest.json`, page code and CSS. It runs in
  Claude's window, hot-reloads when it registers clean-up, and can keep settings: [extensions.md](extensions.md).

## Ask the user first

- Before installing anything from GitHub or another source: it runs code in Claude's window. Say what it is and
  where it comes from; pass `--yes` only after they agree.
- Before removing a theme or extension the user made, or one you didn't add in this conversation.
- Before `{{CINNAMON}} update`, `install` or `uninstall`: they change the login item and what runs at every launch.

## Limits

- Native macOS menus (the menu bar, right-click menus) and permission prompts can't be themed.
- Downloaded extensions run in the page only (no main-process code); only built-in ones have a main part.
- Cinnamon's injection needs Claude's Developer Mode (Help → Troubleshooting → Enable Developer Mode) and the
  Accessibility permission for Cinnamon Helper; `doctor` says when either is missing.
