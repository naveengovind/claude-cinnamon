// The Code tab's colours, handed to Claude Code's own theme API. Claude Code mods can paint the desktop app's Code tab
// ($.theme.set), so Cinnamon leaves that to its small mod (mod/cinnamon-colors) and only paints what mods can't. This
// turns a Cinnamon theme into the colour data the app paints (through makeColors, the design system's own builder
// that Claude Code ships for mods) and writes it where the mod reads it. Pure apart from `write`. No Electron.
//
// A theme maps itself the way its keys already map to the app's variables (ThemeEngine.TOKENS): background-deep →
// surface-0 (or background when absent), background → surface-1, raised → surface-2, panel → surface-3,
// text / text-secondary / text-muted, and accent / danger / success as roles. Only hex
// colours carry over. The app refuses a whole theme whose text fails its contrast bar, so anchors are dropped (in the
// order below) until it paints; the design system fills a dropped one in. A theme can give its own makeColors input
// as "codeTab": { … }, or opt out with "codeTab": false. A theme with a window material (Glass) has no look: mods
// can't make the window see-through, so Cinnamon keeps painting it everywhere.
import fs from 'node:fs';
import path from 'node:path';
import type { Theme } from './ThemeEngine';
import { makeColors, type Anchors, type MakeColorsDefinition, type Mode, type Roles } from './vendor/make-colors.js';

export interface Look {
  /** `<theme id>:<hash of the colours>`: the mod sets the theme again when it changes. */
  id: string;
  /** What `$.theme.set({ colors })` takes. */
  colors: unknown;
  /** Anchors left to the design system so the app would paint the theme. */
  dropped: string[];
}
export interface LookResult { look: Look | null; reason?: string }

const MODES = ['dark', 'light'] as const;
const ANCHORS: Readonly<Record<string, keyof Anchors>> = {
  'background-deep': 'surface-0', background: 'surface-1', raised: 'surface-2', panel: 'surface-3',
  text: 'text-primary', 'text-secondary': 'text-secondary', 'text-muted': 'text-muted',
};
const ROLES = ['accent', 'danger', 'success'] as const;
/** Dropped one after another (cumulatively) until the app would paint the theme. */
const DROP_ORDER = ['surface-3', 'text-muted', 'text-secondary', 'surface-2', 'surface-1', 'roles'] as const;
const REFUSED = "Desktop won't paint";
/** The input names whose app variables (--cds-<name>) identify a look on the page. */
const PRINT_KEYS = ['gray-0', 'gray-100', 'gray-500', 'gray-800', 'gray-900', 'role-accent-600', 'role-danger-600', 'role-success-600'];

/** #abc → #aabbcc; anything but 3- or 6-digit hex → null (the app takes six-digit hex only). */
function hex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return null;
}

/** FNV-1a, 32 bits: a short, stable id for a colour set (no crypto needed in Claude's main process). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export class CodeTabLook {
  /** The theme keys a look carries: where the app paints the look, Cinnamon's colours for these step aside. */
  static readonly KEYS: ReadonlySet<string> = new Set([...Object.keys(ANCHORS), ...ROLES]);
  /** In the mod's own folder (~/.claude/skills/cinnamon-colors/look.json), where the mod reads it. */
  static readonly FILE = 'look.json';

  /** The theme's Code-tab look, or null and why. */
  static fromTheme(id: string, theme: Theme | null | undefined): LookResult {
    if (!theme) return { look: null, reason: 'no theme' };
    if (theme.window !== undefined) return { look: null, reason: 'it uses a window material, which only Cinnamon can paint' };
    if (theme.codeTab === false) return { look: null, reason: 'the theme opts out ("codeTab": false)' };
    const label = typeof theme.name === 'string' && theme.name.trim() ? theme.name.trim() : id;
    if (theme.codeTab && typeof theme.codeTab === 'object') {
      const def = { ...(theme.codeTab as object), label } as MakeColorsDefinition;
      return CodeTabLook.paint(id, def, []);
    }
    const modes: Partial<Record<(typeof MODES)[number], Mode>> = {};
    for (const m of MODES) {
      const section = theme[m];
      if (!section || typeof section !== 'object') continue;
      const anchors: Record<string, string> = {};
      for (const [key, anchor] of Object.entries(ANCHORS)) { const v = hex(section[key]); if (v) anchors[anchor] = v; }
      if (!anchors['surface-0'] && anchors['surface-1']) anchors['surface-0'] = anchors['surface-1'];
      if (!anchors['surface-0'] || !anchors['text-primary']) continue;
      const roles: Roles = {};
      for (const r of ROLES) { const v = hex(section[r]); if (v) roles[r] = v; }
      modes[m] = { gray: { anchors: anchors as Anchors }, ...(Object.keys(roles).length ? { roles } : {}) };
    }
    if (!modes.dark && !modes.light) return { look: null, reason: 'no mode has a hex background and text' };
    // try the full set first, then drop anchors one after another
    for (let n = 0; n <= DROP_ORDER.length; n++) {
      const dropped = DROP_ORDER.slice(0, n);
      const def: MakeColorsDefinition = { label };
      for (const m of MODES) {
        const mode = modes[m];
        if (!mode) continue;
        const anchors = { ...mode.gray!.anchors! } as Record<string, string>;
        for (const d of dropped) delete anchors[d];
        def[m] = { gray: { anchors: anchors as Anchors }, ...(mode.roles && !dropped.includes('roles') ? { roles: mode.roles } : {}) };
      }
      const r = CodeTabLook.paint(id, def, [...dropped]);
      if (r.look) return r;
      if (n === DROP_ORDER.length) return r;
    }
    return { look: null, reason: 'unreachable' };
  }

  /** makeColors, accepted only when the app would paint the result. */
  private static paint(id: string, def: MakeColorsDefinition, dropped: string[]): LookResult {
    try {
      const { theme, problems } = makeColors(def);
      const refused = problems.find((p) => p.startsWith(REFUSED));
      if (refused) return { look: null, reason: refused };
      // A half the theme leaves out comes from the design system's own colours, a hair off the app's stock ones
      // (#f9f9f7 for #f9f9f9 in light mode); the app paints those even when the half is left out of the data.
      return { look: { id: `${id}:${hash(JSON.stringify(theme))}`, colors: theme, dropped } };
    } catch (e) {
      return { look: null, reason: String((e as Error).message || e) };
    }
  }

  /**
   * A few of the look's colours, as the app's variables, per mode: how the page recognises that the palette the app
   * paints is this look (core/page/runtime.ts). Gray-scale and role stops only, which Cinnamon's own CSS never sets.
   */
  static print(look: Look | null): Partial<Record<'dark' | 'light', Record<string, string>>> | null {
    const inputs = (look?.colors as { inputs?: Record<string, Record<string, string>> } | undefined)?.inputs;
    if (!inputs) return null;
    const out: Partial<Record<'dark' | 'light', Record<string, string>>> = {};
    for (const m of MODES) {
      const mode = inputs[m];
      if (!mode) continue;
      const print: Record<string, string> = {};
      for (const k of PRINT_KEYS) if (typeof mode[k] === 'string') print[`--cds-${k}`] = mode[k]!;
      if (Object.keys(print).length) out[m] = print;
    }
    return Object.keys(out).length ? out : null;
  }

  /** Writes what the mod reads (temp file + rename, so it never reads half a file). True when the file changed. */
  static write(file: string, look: Look | null): boolean {
    const text = JSON.stringify(look ? { id: look.id, colors: look.colors } : { id: null }) + '\n';
    try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return true;
  }
}
