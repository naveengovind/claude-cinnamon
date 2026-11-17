# Cinnamon themes

A theme is one JSON file, `{{USER_DIR}}/themes/<id>.json` (`id`: lowercase letters, digits, `-`). Saving it applies
live if it's the current theme; `{{CINNAMON}} theme <id>` switches to it. Same id as a built-in theme overrides it.
Start from a built-in one: `{{ROOT}}/themes/codex.json` (dark, neutral), `{{ROOT}}/themes/glass.json` (see-through
window) or `{{ROOT}}/themes/ember.json` (an animated backdrop under one veil: how to do a see-through theme).

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

## See-through themes: don't stack the colour

Use opaque colours (six-digit hex) unless the user asks for something see-through: glass, transparency, or an
animated or picture background showing through. See-through colours are where themes go wrong.

**Why:** the app paints the same colour on layers that sit on top of each other. For example, the chat area's colour
is painted again on a strip under the message box, on the message box's dock while text scrolls under it, and on the
scroll fades. With an opaque colour those layers are invisible. With a see-through one, every extra layer adds
another coat, so the doubled-up places show as darker bands and boxes. The area around the message box is where it
shows most.

Cinnamon already makes those three layers (the strip, the dock and the fades) transparent whenever `background` is
see-through. Everything else is up to the theme:

1. **Tint once.** Paint the see-through colour, or the picture or animation, in one place: `body` in `css`, as
   glass.json does, or a fixed `body::before` layer with `z-index: -1` and `pointer-events: none`. Then make the big
   surfaces that cover the window `transparent`, not see-through: `background`, `background-deep`, `frame` and
   `panel`, and `sidebar` if the backdrop should show there too. A colour like `#1a0902a6` on `background` *and*
   `panel` *and* `sidebar` stacks.
2. **Keep the things you read off nearly solid**: `popover` (menus and the message box) and `raised` (dialogs, cards)
   at about 90% opacity or more (`e6`–`f2` in eight-digit hex). Use `code-background` and `hover`/`selected` as light
   overlays (alpha `1a`–`40`).
3. **Never fix a band by darkening something else.** That just adds another coat. Find the layer that's doubling up
   and make it `transparent`. To find it, compare how the area looks when the chat is short with how it looks while
   long text scrolls behind the message box.
4. **Respect reduced motion** for animated backgrounds:
   `@media (prefers-reduced-motion: reduce) { body::before, body::after { animation: none !important; } }`.

When you finish a see-through theme, look at it with `{{CINNAMON}} screenshot` (SKILL.md, "Look at your work"):
the message box area with text behind it, the sidebar edge, and text over the brightest part of the backdrop.

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
or values, and `{{CINNAMON}} status` shows the current theme. `{{CINNAMON}} theme <id>` prints `not applied:` for
anything rejected and `note:` for see-through colours that stack. Fix every note before you're done; each one is a
band or box the user would see. Then take a screenshot and look: a note-free theme can still be hard to read. Keep text readable: aim for 7:1 contrast for `text`
on `background`, and 4.5:1 for `text-muted`.
