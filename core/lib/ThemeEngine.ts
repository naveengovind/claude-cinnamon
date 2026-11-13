// Themes: JSON colour schemes turned into CSS that overrides the Claude page's own colour variables.
// Pure: no files, no Electron. Used by the main process (through ThemeStore) and by `cinnamon theme install`.
//
// A theme file:  { "name", "description", "dark": { <key>: colour, …, "vars": { "--any-var": value } },
//                  "light": { … }, "css": "extra CSS", "window": { "vibrancy": "<macOS material>" } }
// Keys are the names in TOKENS; each sets every app variable listed for it. A missing key, or a missing mode
// section, leaves Claude's own colour. Values that could escape a declaration are rejected.

export type ModeName = 'dark' | 'light';
export type ModeSection = Record<string, unknown> & { vars?: Record<string, unknown> };
export interface Theme {
  name?: unknown;
  description?: unknown;
  dark?: ModeSection;
  light?: ModeSection;
  css?: unknown;
  window?: { vibrancy?: unknown };
  [key: string]: unknown;
}
export interface WindowOptions { vibrancy: string }
export interface ThemeCss { css: string; errors: string[] }

// Named colour keys → the app's CSS custom properties (Claude desktop, Nov 2026, "cds" design system).
// Anchoring on variables, not elements, keeps themes working when the app's markup changes; a variable the app
// stops using simply has no effect.
export const TOKENS: Readonly<Record<string, readonly string[]>> = {
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
interface Scoped { sel(mode: ModeName): string; props(mode: ModeName): string[] }
const SCOPED: Readonly<Record<string, Scoped>> = {
  sidebar: { sel: () => '.dframe-sidebar', props: () => ['background-color'] },
  'text-sidebar': { sel: () => '.dframe-sidebar', props: () => ['--cds-text-primary'] },
  'code-background': { sel: (mode) => `[style*="--code-theme-${mode}-bg"]`, props: (mode) => [`--code-theme-${mode}-bg`, '--code-theme-bg'] },
};

const MODES: Readonly<Record<ModeName, { roots: string[]; system: string }>> = {
  dark: { roots: ['[data-mode="dark"]', '.cds-dark-scope[data-mode="dark"]'], system: 'dark' },
  light: { roots: ['[data-mode="light"]'], system: 'light' },
};

// Colour values: plain characters only (no quotes, backslashes, comments or ; { } < > : @), balanced brackets, and the
// only functions allowed are colour ones — so a value can't load anything (url(), image-set()…) or break the sheet.
const COLOR_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix',
  'var', 'calc', 'min', 'max', 'clamp', 'light-dark']);
// Extra css: no escapes, nothing that can load or embed anything.
const CSS_REFUSED = [/\\/, /@import/i, /@font-face/i, /image-set\s*\(/i, /(^|[^-\w])image\s*\(/i, /cross-fade\s*\(/i, /element\s*\(/i,
  /expression\s*\(/i, /<\/?style/i, /url\(\s*(?!['"]?data:)/i];
// macOS window materials Electron accepts for BrowserWindow.setVibrancy
const MATERIALS = new Set(['titlebar', 'selection', 'menu', 'popover', 'sidebar', 'header', 'sheet', 'window', 'hud',
  'fullscreen-ui', 'tooltip', 'content', 'under-window', 'under-page']);
const VAR_NAME = /^--[A-Za-z0-9_-]+$/;

export class ThemeEngine {
  static readonly TOKENS = TOKENS;

  /** A colour value that can't escape its declaration or load anything. */
  static safeValue(v: unknown): v is string {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (!s || s.length > 200 || !/^[A-Za-z0-9#%.,()\s+\-*/_]+$/.test(s) || s.includes('/*') || s.includes('*/')) return false;
    let depth = 0;
    for (const ch of s) { if (ch === '(') depth++; else if (ch === ')' && --depth < 0) return false; }
    if (depth !== 0) return false;
    for (const m of s.matchAll(/([A-Za-z_-][\w-]*)\s*\(/g)) if (!COLOR_FUNCS.has(m[1]!.toLowerCase())) return false;
    return true;
  }

  /** The theme's window material, or null (an unknown material is reported in `errors`). */
  static windowOptions(theme: Theme | null | undefined, errors: string[]): WindowOptions | null {
    const v = theme && theme.window && theme.window.vibrancy;
    if (v === undefined) return null;
    if (typeof v === 'string' && MATERIALS.has(v)) return { vibrancy: v };
    errors.push(`window.vibrancy: ${JSON.stringify(v)} is not a macOS window material`);
    return null;
  }

  /** Theme object → { css, errors }. */
  static css(theme: Theme | null | undefined): ThemeCss {
    const errors: string[] = [];
    let css = '';
    for (const [mode, m] of Object.entries(MODES) as [ModeName, (typeof MODES)[ModeName]][]) {
      if (!theme || !theme[mode]) continue;
      const { root, scoped } = ThemeEngine.declarations(theme[mode], mode, errors);
      // explicit mode, plus "follow system" when the system is in this mode
      const sel = (r: string) => [`:root${r.startsWith('.') ? '' : r}`, `${r} .cds-root`, `${r} .dframe-root`].filter((s) => s !== ':root');
      const rootSel = m.roots.flatMap((r) => (r.startsWith('.') ? [r] : sel(r)));
      const sysRootSel = [':root[data-mode="system"]', '[data-mode="system"] .cds-root', '[data-mode="system"] .dframe-root'];
      css += ThemeEngine.block(rootSel, root);
      for (const [s, decls] of scoped) css += ThemeEngine.block([`[data-mode="${mode}"] ${s}`], decls);
      let sys = ThemeEngine.block(sysRootSel, root);
      for (const [s, decls] of scoped) sys += ThemeEngine.block([`[data-mode="system"] ${s}`], decls);
      if (sys) css += `@media (prefers-color-scheme: ${m.system}) {\n${sys}}\n`;
    }
    if (theme && typeof theme.css === 'string' && theme.css.trim()) {
      // a theme can't load or report anything elsewhere: no escapes, @import, @font-face, image functions, non-data: urls
      const extra = theme.css;
      if (CSS_REFUSED.some((re) => re.test(extra))) errors.push('css: rejected (escapes, @import, @font-face, image functions and non-data: url() are not allowed)');
      else css += `${extra}\n`;
    }
    return { css, errors };
  }

  private static declarations(section: ModeSection | undefined, mode: ModeName, errors: string[]) {
    const root: string[] = [];
    const scoped = new Map<string, string[]>(); // selector → declarations
    for (const [key, value] of Object.entries(section || {})) {
      if (key === 'vars') continue;
      if (!(key in TOKENS)) { errors.push(`${mode}: unknown colour key "${key}"`); continue; }
      if (!ThemeEngine.safeValue(value)) { errors.push(`${mode}.${key}: rejected value ${JSON.stringify(value)}`); continue; }
      const v = value.trim();
      for (const name of TOKENS[key]!) root.push(`${name}: ${v} !important;`);
      const sc = SCOPED[key];
      if (sc) {
        const sel = sc.sel(mode);
        if (!scoped.has(sel)) scoped.set(sel, []);
        for (const prop of sc.props(mode)) scoped.get(sel)!.push(`${prop}: ${v} !important;`);
      }
    }
    for (const [name, value] of Object.entries((section && section.vars) || {})) {
      if (!VAR_NAME.test(name)) { errors.push(`${mode}.vars: rejected variable name ${JSON.stringify(name)}`); continue; }
      if (!ThemeEngine.safeValue(value)) { errors.push(`${mode}.vars.${name}: rejected value ${JSON.stringify(value)}`); continue; }
      root.push(`${name}: ${value.trim()} !important;`);
    }
    return { root, scoped };
  }

  private static block(selectors: string[], decls: string[]): string {
    return decls.length ? `${selectors.join(',\n')} {\n  ${decls.join('\n  ')}\n}\n` : '';
  }
}

export const themeCss = (theme: Theme | null | undefined): ThemeCss => ThemeEngine.css(theme);
