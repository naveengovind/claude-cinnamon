// Themes: JSON color schemes turned into CSS that overrides the Claude page's own color variables.
// Pure: no files, no Electron. Used by the main process (through ThemeStore) and by `cinnamon theme install`.
//
// A theme file:  { "name", "description", "dark": { <key>: color, …, "vars": { "--any-var": value } },
//                  "light": { … }, "css": "extra CSS", "window": { "vibrancy": "<macOS material>" } }
// Keys are the names in TOKENS; each sets every app variable listed for it. A missing key, or a missing mode
// section, leaves Claude's own color. Values that could escape a declaration are rejected.

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
export interface ThemeCssOptions {
  /**
   * The color keys the theme's Code-tab look carries (CodeTabLook.KEYS), painted by Claude Code's own theme API:
   * they step aside wherever the app paints this theme's look (the Code tab: Cinnamon's page code marks the root with
   * data-cinnamon-code-tab="mod" when the app's mod palette is the current look), so the two never fight. A palette
   * that isn't the current look gets painted over. Every other key (sidebar, popover, borders, buttons, code
   * panels…), `vars` and extra css stay Cinnamon's everywhere: the look can't express them.
   */
  yieldKeys?: ReadonlySet<string>;
}
/** Set on the root by Cinnamon's page code while the app paints the current look through Claude Code's theme API. */
export const MOD_PAINTED = '[data-cinnamon-code-tab="mod"]';
/** A selector that matches nothing at or under that mark. (Not @scope: Chrome's leaves out the <html> root.) */
export const outsideModPalette = (sel: string): string => `${sel}:not(${MOD_PAINTED}, ${MOD_PAINTED} *)`;

// Named color keys → the app's CSS custom properties (Claude desktop, Nov 2026, "cds" design system).
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
// Code panels and code blocks take their colors from the user's code theme, set inline on the element; an
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

// Color values: plain characters only (no quotes, backslashes, comments or ; { } < > : @), balanced brackets, and the
// only functions allowed are color ones — so a value can't load anything (url(), image-set()…) or break the sheet.
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

  /** A color value that can't escape its declaration or load anything. */
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

  /** Whether a color lets what's behind it show through (an alpha under 1, `transparent`, a mix with it). */
  static isSeeThrough(v: unknown): boolean {
    if (typeof v !== 'string') return false;
    const s = v.trim().toLowerCase();
    if (s === 'transparent') return true;
    const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/.exec(s);
    if (hex) return hex[1]!.length === 4 ? hex[1]!.at(-1) !== 'f' : hex[1]!.slice(-2) !== 'ff';
    if (/^color-mix\(/.test(s)) return /\btransparent\b/.test(s);
    const fn = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((.*)\)$/.exec(s);
    if (!fn) return false;
    const body = fn[1]!;
    const alpha = body.includes('/') ? body.split('/').pop()!.trim() : (body.split(',').length === 4 ? body.split(',').pop()!.trim() : null);
    if (alpha === null) return false;
    const n = alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha);
    return Number.isFinite(n) && n < 1;
  }

  /**
   * Advice, not errors: see-through colors on surfaces that cover each other darken where they overlap (bands and
   * boxes, around the message box most of all). `transparent` is fine: it adds no coat.
   */
  static notes(theme: Theme | null | undefined): string[] {
    const notes: string[] = [];
    const tinted = (v: unknown) => ThemeEngine.isSeeThrough(v) && String(v).trim().toLowerCase() !== 'transparent';
    // what sits on top of what: the chat area and the sidebar both sit on the frame; panels and wells on the chat area
    const over: [string, string[]][] = [['background', ['background-deep', 'panel']], ['frame', ['background', 'sidebar']]];
    for (const mode of ['dark', 'light'] as const) {
      const s = theme?.[mode];
      if (!s) continue;
      for (const [under, tops] of over) {
        if (!tinted(s[under])) continue;
        for (const key of tops) {
          if (tinted(s[key])) notes.push(`${mode}: ${under} and ${key} are both see-through and ${key} sits on ${under}, so it comes out darker. Tint once: make one of them "transparent".`);
        }
      }
    }
    return notes;
  }

  /** Everything wrong with a theme: rejected keys, values, css and window material (nothing is applied for those). */
  static problems(theme: Theme | null | undefined): string[] {
    const { errors } = ThemeEngine.css(theme);
    ThemeEngine.windowOptions(theme, errors);
    return errors;
  }

  /** Theme object → { css, errors }. */
  static css(theme: Theme | null | undefined, opts: ThemeCssOptions = {}): ThemeCss {
    const errors: string[] = [];
    let css = '';
    const yieldKeys = opts.yieldKeys ?? new Set<string>();
    for (const [mode, m] of Object.entries(MODES) as [ModeName, (typeof MODES)[ModeName]][]) {
      if (!theme || !theme[mode]) continue;
      // explicit mode, plus "follow system" when the system is in this mode
      const sel = (r: string) => [`:root${r.startsWith('.') ? '' : r}`, `${r} .cds-root`, `${r} .dframe-root`].filter((s) => s !== ':root');
      const rootSel = m.roots.flatMap((r) => (r.startsWith('.') ? [r] : sel(r)));
      const sysRootSel = [':root[data-mode="system"]', '[data-mode="system"] .cds-root', '[data-mode="system"] .dframe-root'];
      let sys = '';
      // the keys the look carries step aside where the app paints it; the rest are Cinnamon's everywhere
      for (const yielding of [false, true]) {
        const gate = (sels: string[]): string[] => (yielding ? sels.map(outsideModPalette) : sels);
        const keep = (key: string) => yieldKeys.has(key) === yielding;
        const { root, scoped } = ThemeEngine.declarations(theme[mode], mode, yielding ? [] : errors, keep);
        if (!yielding && ThemeEngine.isSeeThrough(theme[mode]!.background)) {
          // The app paints the chat background again on strips around the message box (the sticky strip under it,
          // the dock mask while text scrolls under it, the scroll fades); with nothing else painting the chat area,
          // a see-through color there shows as dark bands. Those strips go transparent instead.
          const clear = '--epitaxy-transcript-surface: transparent !important;';
          root.push(clear);
          scoped.set('[class*="--epitaxy-transcript-surface:"]', [clear]);
          scoped.set('[data-cds-dock-masked]', ['--cds-page-bg: transparent !important;']);
        }
        css += ThemeEngine.block(gate(rootSel), root);
        for (const [s, decls] of scoped) css += ThemeEngine.block(gate([`[data-mode="${mode}"] ${s}`]), decls);
        sys += ThemeEngine.block(gate(sysRootSel), root);
        for (const [s, decls] of scoped) sys += ThemeEngine.block(gate([`[data-mode="system"] ${s}`]), decls);
      }
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

  /** `keep` picks the keys (`vars` counts as the key "vars"). */
  private static declarations(section: ModeSection | undefined, mode: ModeName, errors: string[], keep: (key: string) => boolean = () => true) {
    const root: string[] = [];
    const scoped = new Map<string, string[]>(); // selector → declarations
    for (const [key, value] of Object.entries(section || {})) {
      if (key === 'vars' || !keep(key)) continue;
      if (!(key in TOKENS)) { errors.push(`${mode}: unknown color key "${key}"`); continue; }
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
    for (const [name, value] of Object.entries((keep('vars') && section && section.vars) || {})) {
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

export const themeCss = (theme: Theme | null | undefined, opts?: ThemeCssOptions): ThemeCss => ThemeEngine.css(theme, opts);
