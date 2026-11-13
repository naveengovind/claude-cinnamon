// Themes: JSON colour schemes turned into CSS that overrides the Claude page's own colour variables.
// Used by the main process (apply-main.js.tmpl). Pure functions plus small file helpers; no Electron.
//
// A theme file:  { "name", "description", "dark": { <key>: colour, …, "vars": { "--any-var": value } },
//                  "light": { … }, "css": "extra CSS" }
// Keys are the names in TOKENS; each sets every app variable listed for it. A missing key, or a missing mode
// section, leaves Claude's own colour. Values that could escape a declaration are rejected.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Named colour keys → the app's CSS custom properties (Claude desktop, Nov 2026, "cds" design system).
// Anchoring on variables, not elements, keeps themes working when the app's markup changes; a variable the app
// stops using simply has no effect.
const TOKENS = {
  background: ['--cds-surface-1', '--cds-page-bg'],
  frame: ['--df-bg-page'], // the app frame behind the main area (glass themes make it transparent)
  'background-deep': ['--cds-surface-0'],
  sidebar: ['--cds-fizzy-lake-color-sidebar'], // also painted directly on the sidebar (it is drawn 90% opaque)
  raised: ['--cds-surface-2', '--cds-fizzy-lake-color-card-hover'], // dialogs, raised cards
  panel: ['--cds-surface-3'],
  popover: ['--cds-surface-popover'], // dropdowns, menus, popovers, and the message box
  text: ['--cds-text-primary', '--cds-fizzy-lake-color-solid-primary'],
  'text-sidebar': [], // the sidebar's --cds-text-primary (see SCOPED)
  'code-background': [], // terminal / changes / files panels and code blocks (see SCOPED)
  'text-secondary': ['--cds-text-secondary', '--cds-text-stays-secondary', '--cds-fizzy-lake-color-secondary',
    '--cds-fizzy-lake-color-plain-secondary', '--cds-fizzy-lake-color-solid-secondary', '--cds-shortcut-cap-ink',
    '--muted-as-secondary'],
  'text-muted': ['--cds-text-muted', '--cds-fizzy-lake-color-plain-muted', '--cds-fizzy-lake-color-solid-muted',
    '--cds-fizzy-lake-color-icon-only-disabled', '--cds-text-button-disabled'],
  placeholder: ['--cds-fizzy-lake-color-placeholder'],
  border: ['--cds-border-line', '--cds-border-line-muted'],
  'border-faint': ['--cds-border'],
  hover: ['--cds-fill-ghost-hover', '--cds-bg-neutral-hover', '--cds-fill-button-ghost-hover', '--cds-fill-button-layer',
    '--cds-fill-secondary-layer', '--df-hover'],
  selected: ['--cds-fill-ghost-selected'],
  'selected-hover': ['--cds-fizzy-lake-color-selected-hover'],
  button: ['--cds-fill-primary'],
  'button-hover': ['--cds-fill-primary-hover'],
  'button-text': ['--cds-on-primary'],
  'button-secondary': ['--cds-fill-secondary'],
  'button-secondary-hover': ['--cds-fill-secondary-hover'],
  accent: ['--cds-role-accent-450'],
  'accent-hover': ['--cds-fill-accent-hover'],
  danger: ['--cds-fill-danger'],
  'text-danger': ['--cds-text-danger'],
  success: ['--cds-fill-success'],
  'text-success': ['--cds-text-success'],
};
// Keys painted on particular elements rather than the page root: selector → properties, per mode.
// Code panels and code blocks take their colours from the user's code theme, set inline on the element; an
// !important stylesheet rule beats a normal inline declaration.
const SCOPED = {
  sidebar: { sel: () => '.dframe-sidebar', props: () => ['background-color'] },
  'text-sidebar': { sel: () => '.dframe-sidebar', props: () => ['--cds-text-primary'] },
  'code-background': { sel: (mode) => `[style*="--code-theme-${mode}-bg"]`, props: (mode) => [`--code-theme-${mode}-bg`, '--code-theme-bg'] },
};

const MODES = {
  dark: { roots: ['[data-mode="dark"]', '.cds-dark-scope[data-mode="dark"]'], system: 'dark' },
  light: { roots: ['[data-mode="light"]'], system: 'light' },
};

// Colour values: plain characters only (no quotes, backslashes, comments or ; { } < > : @), balanced brackets, and the
// only functions allowed are colour ones — so a value can't load anything (url(), image-set()…) or break the sheet.
const COLOR_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix',
  'var', 'calc', 'min', 'max', 'clamp', 'light-dark']);
function safeValue(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > 200 || !/^[A-Za-z0-9#%.,()\s+\-*/_]+$/.test(s) || s.includes('/*') || s.includes('*/')) return false;
  let depth = 0;
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')' && --depth < 0) return false; }
  if (depth !== 0) return false;
  for (const m of s.matchAll(/([A-Za-z_-][\w-]*)\s*\(/g)) if (!COLOR_FUNCS.has(m[1].toLowerCase())) return false;
  return true;
}
// Extra css: no escapes, nothing that can load or embed anything.
const CSS_REFUSED = [/\\/, /@import/i, /@font-face/i, /image-set\s*\(/i, /(^|[^-\w])image\s*\(/i, /cross-fade\s*\(/i, /element\s*\(/i,
  /expression\s*\(/i, /<\/?style/i, /url\(\s*(?!['"]?data:)/i];
// macOS window materials Electron accepts for BrowserWindow.setVibrancy
const MATERIALS = new Set(['titlebar', 'selection', 'menu', 'popover', 'sidebar', 'header', 'sheet', 'window', 'hud',
  'fullscreen-ui', 'tooltip', 'content', 'under-window', 'under-page']);

function windowOptions(theme, errors) {
  const v = theme && theme.window && theme.window.vibrancy;
  if (v === undefined) return null;
  if (typeof v === 'string' && MATERIALS.has(v)) return { vibrancy: v };
  errors.push(`window.vibrancy: ${JSON.stringify(v)} is not a macOS window material`);
  return null;
}
const VAR_NAME = /^--[A-Za-z0-9_-]+$/;

function modeDeclarations(section, mode, errors) {
  const root = [];
  const scoped = new Map(); // selector → declarations
  for (const [key, value] of Object.entries(section || {})) {
    if (key === 'vars') continue;
    if (!(key in TOKENS)) { errors.push(`${mode}: unknown colour key "${key}"`); continue; }
    if (!safeValue(value)) { errors.push(`${mode}.${key}: rejected value ${JSON.stringify(value)}`); continue; }
    const v = value.trim();
    for (const name of TOKENS[key]) root.push(`${name}: ${v} !important;`);
    if (key in SCOPED) {
      const sel = SCOPED[key].sel(mode);
      if (!scoped.has(sel)) scoped.set(sel, []);
      for (const prop of SCOPED[key].props(mode)) scoped.get(sel).push(`${prop}: ${v} !important;`);
    }
  }
  for (const [name, value] of Object.entries((section && section.vars) || {})) {
    if (!VAR_NAME.test(name)) { errors.push(`${mode}.vars: rejected variable name ${JSON.stringify(name)}`); continue; }
    if (!safeValue(value)) { errors.push(`${mode}.vars.${name}: rejected value ${JSON.stringify(value)}`); continue; }
    root.push(`${name}: ${value.trim()} !important;`);
  }
  return { root, scoped };
}

function block(selectors, decls) {
  return decls.length ? `${selectors.join(',\n')} {\n  ${decls.join('\n  ')}\n}\n` : '';
}

/** Theme object → { css, errors }. */
function themeCss(theme) {
  const errors = [];
  let css = '';
  for (const [mode, m] of Object.entries(MODES)) {
    if (!theme || !theme[mode]) continue;
    const { root, scoped } = modeDeclarations(theme[mode], mode, errors);
    // explicit mode, plus "follow system" when the system is in this mode
    const sel = (r) => [`:root${r.startsWith('.') ? '' : r}`, `${r} .cds-root`, `${r} .dframe-root`].filter((s) => s !== ':root');
    const rootSel = m.roots.flatMap((r) => (r.startsWith('.') ? [r] : sel(r)));
    const sysRootSel = [':root[data-mode="system"]', '[data-mode="system"] .cds-root', '[data-mode="system"] .dframe-root'];
    css += block(rootSel, root);
    for (const [sel, decls] of scoped) css += block([`[data-mode="${mode}"] ${sel}`], decls);
    let sys = block(sysRootSel, root);
    for (const [sel, decls] of scoped) sys += block([`[data-mode="system"] ${sel}`], decls);
    if (sys) css += `@media (prefers-color-scheme: ${m.system}) {\n${sys}}\n`;
  }
  if (theme && typeof theme.css === 'string' && theme.css.trim()) {
    // a theme can't load or report anything elsewhere: no escapes, @import, @font-face, image functions, non-data: urls
    if (CSS_REFUSED.some((re) => re.test(theme.css))) errors.push('css: rejected (escapes, @import, @font-face, image functions and non-data: url() are not allowed)');
    else css += `${theme.css}\n`;
  }
  return { css, errors };
}

/** Themes in the given folders (later folders override the same id), sorted by name. */
function listThemes(dirs) {
  const byId = new Map();
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const id = f.slice(0, -5);
      if (id === 'default') continue; // "Default" always means Claude's own colours
      const file = path.join(dir, f);
      try {
        const t = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!t || typeof t !== 'object') throw new Error('not an object');
        byId.set(id, { id, name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : id, description: typeof t.description === 'string' ? t.description : '', file, theme: t });
      } catch (e) {
        byId.set(id, { id, name: id, description: '', file, error: String(e.message || e) });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readConfig(file) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
  if (typeof cfg.theme !== 'string' || !cfg.theme) cfg.theme = 'default';
  return cfg;
}

function writeConfig(file, patch) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
  const next = { ...cur, ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return next;
}

/** The configured theme: { current, css, errors, themes: [{ id, name, description, error? }] }. */
function resolveTheme(dirs, configFile) {
  const themes = listThemes(dirs);
  const want = readConfig(configFile).theme;
  const found = themes.find((t) => t.id === want && !t.error);
  const { css, errors } = found ? themeCss(found.theme) : { css: '', errors: [] };
  return {
    current: found ? found.id : 'default',
    css,
    window: found ? windowOptions(found.theme, errors) : null,
    errors,
    themes: themes.map(({ id, name, description, error }) => ({ id, name, description, ...(error ? { error } : {}) })),
  };
}

module.exports = { TOKENS, themeCss, listThemes, readConfig, writeConfig, resolveTheme };
