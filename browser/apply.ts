// What the extension's background does to one claude.ai document, worked out without Chrome: which CSS to insert and
// remove, which extensions to take out and run, and the snippets it runs in the page (the MAIN world). The document
// itself records which extension code runs in it (window.__cinnamonBrowser.ran, core/browser/page.ts), and the snippet
// that runs an extension checks and marks that in the same step, so code never runs twice in one document.
import { DISPOSED, type HostState, type WebExtension } from '../core/browser/protocol';

const q = (s: string): string => JSON.stringify(s);

/** In the page: the extensions running in this document (id → signature), or null when Cinnamon isn't in it yet. */
export const PROBE = '(() => { const b = window.__cinnamonBrowser; return b ? JSON.stringify(b.ran) : null; })()';

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
  const run = exts.filter((e) => ran[e.id] !== e.sig && e.code.trim());
  return { dispose, run };
}

/** In the page: runs an extension's code unless this document already runs that version of it. */
export function runSnippet(e: WebExtension): string {
  return `(() => { const b = window.__cinnamonBrowser; if (!b || b.ran[${q(e.id)}] === ${q(e.sig)}) return 'skip'; b.ran[${q(e.id)}] = ${q(e.sig)};
${e.code}
;return 'ran'; })()`;
}

/** In the page: takes an extension out through its clean-up; anything but DISPOSED means the tab must be reloaded. */
export function disposeSnippet(id: string): string {
  return `(() => { const r = window.__cinnamon ? window.__cinnamon.dispose(${q(id)}) : false; if (r === ${q(DISPOSED)} && window.__cinnamonBrowser) delete window.__cinnamonBrowser.ran[${q(id)}]; return r || false; })()`;
}

/** In the page: the settings, theme list and extension list for the runtime and the Settings rows. */
export function pageStateSnippet(state: HostState): string {
  const themes = JSON.stringify({ current: state.theme.id, themes: state.theme.themes });
  return `(() => { const c = window.__cinnamon; if (c) { c.setSettings(${JSON.stringify(state.settings)}); if (c.setLook) c.setLook(null); }
if (window.__cmSetThemes) window.__cmSetThemes(${themes});
if (window.__cmSetExtensions) window.__cmSetExtensions(${JSON.stringify(state.extList)}); return true; })()`;
}
