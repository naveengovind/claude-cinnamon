# Cinnamon themes

A theme is one JSON file, `{{USER_DIR}}/themes/<id>.json` (`id`: lowercase letters, digits, `-`). Saving it applies
live if it's the current theme; `{{CINNAMON}} theme <id>` switches to it. Same id as a built-in theme overrides it.
Start from a built-in one: `{{ROOT}}/themes/codex.json` (dark, neutral) or `{{ROOT}}/themes/glass.json`
(see-through window).

```json
{
  "name": "Dusk",
  "description": "Blue-grey",
  "dark":  { "background": "#101018", "sidebar": "#14141d", "popover": "#22222e", "text": "#f2f2f7", "accent": "#5b8cff" },
  "light": { "background": "#fbfbfd" }
}
```

A section per mode (`dark`, `light`). A missing section or key keeps Claude's own colour, so a dark-only theme
leaves light mode alone. Values are CSS colours: hex, names, `rgb`/`hsl`/`oklch`/`color-mix`/`var`/`calc`/
`light-dark`…

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
- `"vars": { "--cds-…": "…" }` inside a mode sets any of the app's CSS variables directly.
- `"css": "…"` adds CSS. Refused: backslash escapes, `@import`, `@font-face`, `image()`/`image-set()`/
  `cross-fade()`, and `url()` other than `data:` URLs.
- `"window": { "vibrancy": "under-window" }` makes the window a macOS glass material (needs transparent
  `background`/`frame`/`panel`/`sidebar`, as in glass.json).

## The Code tab

The Code tab's main colours go through Claude Code's own theme API: Cinnamon converts the theme and its
`cinnamon-colors` mod hands it to the app in local Code sessions, and Cinnamon still paints the rest (sidebar,
popovers, borders, hover, buttons, code panels, `vars`, `css`). What carries over: `background-deep`,
`background`, `raised`, `panel`, `text`, `text-secondary`, `text-muted`, `accent`, `danger`, `success`, as
six-digit or three-digit hex only. The app refuses text that's too faint; Cinnamon then leaves that colour to the app
(`{{CINNAMON}} doctor` lists which). Optional:
- `"codeTab": false` keeps the Code tab entirely Cinnamon's.
- `"codeTab": { "dark": { "gray": { "anchors": { "surface-0": "#…", "surface-1": "#…", "surface-2": "#…",
  "surface-3": "#…", "text-primary": "#…", "text-secondary": "#…", "text-muted": "#…" } } }, "roles": { "accent":
  "#…" } }` sets the app's own palette input yourself (`surface-0` darkest, each later surface as light or lighter).
- Themes with `window` (glass) are always Cinnamon's.

## Check

`{{CINNAMON}} theme` lists it (an error is shown next to a broken file), `{{CINNAMON}} doctor` names rejected keys
or values, and `{{CINNAMON}} status` shows the current theme. Keep text readable: aim for 7:1 contrast for `text`
on `background`, and 4.5:1 for `text-muted`.
