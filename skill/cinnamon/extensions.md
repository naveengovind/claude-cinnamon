# Cinnamon extensions

An extension is a folder in `{{USER_DIR}}/extensions/<id>/` (`id`: letters, digits, `.`, `_`, `-`). Its code runs in
Claude's window (the claude.ai page) each time it loads. Saving a file applies it to the running app within a
second; it's on unless the config turns it off.

```
{{USER_DIR}}/extensions/zen/
├── manifest.json   { "id": "zen", "name": "Zen mode", "description": "…", "version": "1.0.0",
│                     "page": ["zen.ts"], "css": ["zen.css"] }
├── zen.ts          page code: TypeScript or JavaScript (Cinnamon compiles TypeScript with Bun)
└── zen.css         CSS, inserted into the page and swapped live
```

- `page` and `css` list files inside the folder, run and inserted in that order. TypeScript may import only files
  inside the extension. A `main` entry (code in Claude's main process) is ignored for your own extensions; only
  built-in ones have one.
- `"enabledByDefault": false` in the manifest keeps it off until `{{CINNAMON}} ext enable <id>`.
- Read the built-in ones as examples: `{{ROOT}}/extensions/full-width/` (a Settings option plus CSS) and
  `{{ROOT}}/extensions/sidebar-cards/` (decorating the session list).

## The `cinnamon` object

Page code gets `cinnamon` (types: `{{ROOT}}/types/cinnamon.d.ts`; start a `.ts` file with
`/// <reference path="{{ROOT}}/types/cinnamon.d.ts" />`):

```ts
cinnamon.settings.get('key');            // this extension's settings, saved in config.json
cinnamon.settings.set('key', value);     // under "settings": { "<id>": { … } }
cinnamon.settings.onChange((all) => …);  // also fires when config.json is edited
cinnamon.onDispose(() => …);             // clean-up: makes the extension hot-reload
```

## Hot reload: always register clean-up

With `cinnamon.onDispose`, an edit to the extension's files (or turning it off) runs your clean-up and then the new
code in place. Without it, Cinnamon has to reload Claude's whole window, which interrupts the user. Undo everything
you added: elements, observers, timers, listeners, attributes.

```ts
/// <reference path="{{ROOT}}/types/cinnamon.d.ts" />
const badge = Object.assign(document.createElement('div'), { className: 'zen-badge', textContent: 'Zen' });
document.body.append(badge);
const observer = new MutationObserver(() => { /* re-apply after the app re-renders */ });
observer.observe(document.body, { childList: true, subtree: true });
const timer = setInterval(() => { /* … */ }, 1000);
cinnamon.onDispose(() => { badge.remove(); observer.disconnect(); clearInterval(timer); });
```

## Writing code that survives app updates

Claude's window is a React app that re-renders and changes between versions:
- Hook onto stable meaning: ARIA roles and labels, visible text, `data-*` attributes, the app's CSS variables
  (`--cds-…`). Never generated class names or element positions.
- Make every hook optional: if what you look for isn't there, do nothing. Catch errors; never break the page.
- Add your own elements (marked with a class or `data-` attribute of yours) rather than changing the app's; watch
  with a `MutationObserver` to put them back after a re-render, and ignore mutations of your own nodes so you don't
  loop.
- Prefer CSS for looks; use code for behaviour.

## Check

`{{CINNAMON}} ext` lists the extension and whether it's on, and shows `error in Claude:` lines for compile errors or
errors its page code threw when it last ran. `{{CINNAMON}} doctor` reports the same. Fix and save; it reloads.
Then `{{CINNAMON}} screenshot` and look at it (SKILL.md, "Look at your work"): where it landed, what it covers.
Errors the code throws later (in a timer or event handler) aren't recorded, so wrap such handlers in `try`/`catch`.
