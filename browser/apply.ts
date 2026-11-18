// What the extension's background does to one claude.ai document, worked out without Chrome: which CSS to insert and
// remove, which extensions to take out and run, and the small functions it runs in the page (the MAIN world) through
// chrome.scripting.executeScript({ func, args }). Those are the extension's own code, not strings evaluated in the
// page, so claude.ai's Content-Security-Policy (no 'unsafe-eval') doesn't refuse them. Cinnamon's page code itself
// arrives as files of the extension's (core/browser/GenFiles.ts), which guard themselves to run once per document.
// Each function here must stand alone: Chrome sends its source, not its closure.
import type { HostState, WebExtension } from '../core/browser/protocol';

/** In the page: the extensions running in this document (id → signature), or null when Cinnamon isn't in it yet. */
export function probe(): string | null {
  const b = (window as unknown as { __cinnamonBrowser?: { ran: Record<string, string> } }).__cinnamonBrowser;
  return b ? JSON.stringify(b.ran) : null;
}

/** In the page: takes an extension out through its clean-up; anything but `disposed` means the tab must be reloaded. */
export function disposeInPage(id: string, disposed: string): string | false {
  const w = window as unknown as { __cinnamon?: { dispose(id: string): string | false }; __cinnamonBrowser?: { ran: Record<string, string> } };
  const r = w.__cinnamon ? w.__cinnamon.dispose(id) : false;
  if (r === disposed && w.__cinnamonBrowser) delete w.__cinnamonBrowser.ran[id];
  return r || false;
}

/** In the page: the settings, theme list and extension list for the runtime and the Settings rows. */
export function pageState(settings: unknown, themes: unknown, extList: unknown): boolean {
  const w = window as unknown as {
    __cinnamon?: { setSettings(s: unknown): void; setLook?(p: unknown): void };
    __cmSetThemes?: (d: unknown) => void;
    __cmSetExtensions?: (d: unknown) => void;
  };
  if (w.__cinnamon) { w.__cinnamon.setSettings(settings); if (w.__cinnamon.setLook) w.__cinnamon.setLook(null); }
  if (w.__cmSetThemes) w.__cmSetThemes(themes);
  if (w.__cmSetExtensions) w.__cmSetExtensions(extList);
  return true;
}

/** The arguments pageState takes for this state. */
export function pageStateArgs(state: HostState): [unknown, unknown, unknown] {
  return [state.settings, { current: state.theme.id, themes: state.theme.themes }, state.extList];
}

/** The CSS a document should have, by key: Cinnamon's own, the theme's and each extension's. */
export function desiredCss(state: HostState): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.core.css.trim()) out.core = state.core.css;
  if (state.theme.css.trim()) out.theme = state.theme.css;
  for (const e of state.extensions) if (e.css.trim()) out[`ext:${e.id}`] = e.css;
  return out;
}

/** CSS to insert (new or changed) and to remove afterwards (changed or gone), so the page never flashes unstyled. */
export function cssPlan(current: Record<string, string>, desired: Record<string, string>): { insert: [string, string][]; remove: [string, string][] } {
  const insert: [string, string][] = [];
  const remove: [string, string][] = [];
  for (const [k, text] of Object.entries(desired)) if (current[k] !== text) insert.push([k, text]);
  for (const [k, text] of Object.entries(current)) if (desired[k] !== text) remove.push([k, text]);
  return { insert, remove };
}

/** Extensions to take out (changed or turned off) and to run (new or changed), from what the document says it runs. */
export function scriptPlan(ran: Record<string, string>, exts: readonly WebExtension[]): { dispose: string[]; run: WebExtension[] } {
  const want = new Map(exts.map((e) => [e.id, e.sig]));
  const dispose = Object.entries(ran).filter(([id, sig]) => want.get(id) !== sig).map(([id]) => id);
  const run = exts.filter((e) => ran[e.id] !== e.sig && e.file);
  return { dispose, run };
}

/** Whether a URL is one the extension works on, by its manifest's match patterns (scheme and host; any port). */
export function matchesAny(url: string, patterns: readonly string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return patterns.some((p) => {
    const m = /^(\*|https?):\/\/([^/]+)\//.exec(p);
    if (!m) return false;
    const [, scheme, host] = m;
    if (scheme !== '*' && `${scheme}:` !== u.protocol) return false;
    return host === '*' || host === u.hostname || (host!.startsWith('*.') && u.hostname.endsWith(host!.slice(1)));
  });
}
