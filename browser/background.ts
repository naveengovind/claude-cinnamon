// The Cinnamon extension's background (service worker). It connects to the cinnamon command on this Mac (Chrome's
// native messaging: `cinnamon browser-host`), which sends everything to put into claude.ai and sends it again whenever
// a theme, an extension or config.json changes. For each claude.ai tab it inserts the CSS (chrome.scripting.insertCSS:
// the page's Content-Security-Policy can't block it) and runs Cinnamon's page code in the page itself, through
// chrome.userScripts when the person allowed user scripts for this extension, else through eval in the page (which the
// page's policy may refuse; the extension then reports it, and `cinnamon doctor` says what to switch on).
//
// The open connection keeps this worker alive. When the folder Chrome loaded the extension from holds a newer version
// (`cinnamon update` rebuilt it), the extension reloads itself, so updates need no clicks.
import { ChunkJoiner } from '../core/browser/NativeMessaging';
import { DISPOSED, HOST_NAME, type HostState } from '../core/browser/protocol';
import { cssPlan, desiredCss, disposeSnippet, pageStateSnippet, PROBE, runSnippet, scriptPlan } from './apply';

const CLAUDE = 'https://claude.ai/*';
const RELOAD_EVERY_MS = 10_000;

let state: HostState | null = null;
let port: chrome.runtime.Port | null = null;
let retryMs = 5_000;
let problem: string | null = null;
const joiner = new ChunkJoiner();
const queues = new Map<number, Promise<unknown>>();
const ready = new Set<number>(); // tabs whose document has reached DOMContentLoaded
const lastReload = new Map<number, number>();

const userScriptsUsable = (): boolean => { try { return typeof chrome.userScripts?.execute === 'function'; } catch { return false; } };

function report(p: string | null): void {
  if (p === problem) return;
  problem = p;
  try { port?.postMessage({ type: 'status', userScripts: userScriptsUsable(), problem }); } catch {}
}

/** Runs code in the tab's page (MAIN world) and returns its value. */
async function exec(tabId: number, code: string): Promise<unknown> {
  const target = { tabId, frameIds: [0] };
  if (userScriptsUsable()) {
    try {
      const r = await chrome.userScripts.execute({ target, world: 'MAIN', js: [{ code }], injectImmediately: true });
      return r[0]?.result;
    } catch { /* not allowed after all: try eval in the page */ }
  }
  const r = await chrome.scripting.executeScript({
    target, world: 'MAIN', injectImmediately: true, args: [code],
    func: (c: string) => { try { return { ok: true, value: (0, eval)(c) as unknown }; } catch (e) { return { ok: false, error: String(e) }; } },
  });
  const out = r[0]?.result as { ok?: boolean; value?: unknown; error?: string } | undefined;
  if (!out?.ok) {
    report(`claude.ai refused Cinnamon's page code (${out?.error ?? 'no result'}). Turn on "Allow User Scripts" for Cinnamon on the browser's extensions page.`);
    throw new Error(out?.error ?? 'could not run code in the page');
  }
  return out.value;
}

// The CSS put into each tab's current document, kept in session storage so a restarted worker can still take it out.
async function cssOf(tabId: number): Promise<Record<string, string>> {
  const all = ((await chrome.storage.session.get('css')).css ?? {}) as Record<string, Record<string, string>>;
  return all[tabId] ?? {};
}
async function setCss(tabId: number, css: Record<string, string> | null): Promise<void> {
  const all = { ...(((await chrome.storage.session.get('css')).css ?? {}) as Record<string, Record<string, string>>) };
  if (css) all[tabId] = css; else delete all[tabId];
  await chrome.storage.session.set({ css: all });
}

async function applyCss(tabId: number): Promise<void> {
  if (!state) return;
  const target = { tabId, frameIds: [0] };
  const current = await cssOf(tabId);
  const desired = desiredCss(state);
  const plan = cssPlan(current, desired);
  const next = { ...current };
  for (const [k, text] of plan.insert) { try { await chrome.scripting.insertCSS({ target, css: text }); next[k] = text; } catch {} }
  for (const [k, text] of plan.remove) {
    try { await chrome.scripting.removeCSS({ target, css: text }); } catch {}
    if (next[k] === text) delete next[k];
  }
  await setCss(tabId, next);
}

async function applyScripts(tabId: number): Promise<void> {
  if (!state) return;
  let ran = await exec(tabId, PROBE);
  if (typeof ran !== 'string') { await exec(tabId, state.core.js); ran = '{}'; } // a fresh document: Cinnamon goes in first
  await exec(tabId, pageStateSnippet(state));
  const plan = scriptPlan(JSON.parse(ran as string) as Record<string, string>, state.extensions);
  for (const id of plan.dispose) {
    if (await exec(tabId, disposeSnippet(id)) !== DISPOSED) { reloadTab(tabId); return; } // code without clean-up
  }
  for (const e of plan.run) await exec(tabId, runSnippet(e));
  report(null);
}

function reloadTab(tabId: number): void {
  const now = Date.now();
  if (now - (lastReload.get(tabId) ?? 0) < RELOAD_EVERY_MS) return;
  lastReload.set(tabId, now);
  void chrome.tabs.reload(tabId).catch(() => {});
}

/** One tab at a time, in order. */
function queue(tabId: number, fn: () => Promise<void>): Promise<unknown> {
  const run = (queues.get(tabId) ?? Promise.resolve()).then(fn).catch(() => {});
  queues.set(tabId, run);
  return run;
}

async function applyAll(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: CLAUDE }).catch(() => [] as chrome.tabs.Tab[]);
  for (const t of tabs) {
    if (typeof t.id !== 'number') continue;
    const id = t.id;
    void queue(id, async () => {
      await applyCss(id);
      if (ready.has(id) || t.status === 'complete') await applyScripts(id);
    });
  }
}

/** True when the extension is about to reload itself into the newer version on disk. */
async function updateIfNewer(s: HostState): Promise<boolean> {
  const mine = chrome.runtime.getManifest().version;
  if (!s.extensionVersion || s.extensionVersion === mine) return false;
  const tried = (await chrome.storage.local.get('reloadedFor')).reloadedFor;
  if (tried === `${mine}->${s.extensionVersion}`) return false; // reloaded for it once already: don't loop
  await chrome.storage.local.set({ reloadedFor: `${mine}->${s.extensionVersion}` });
  chrome.runtime.reload();
  return true;
}

function connect(): void {
  if (port) return;
  try { port = chrome.runtime.connectNative(HOST_NAME); } catch (e) { problem = String(e); return; }
  port.onMessage.addListener((raw) => {
    const m = joiner.add(raw) as HostState | null;
    if (!m || m.type !== 'state') return;
    retryMs = 5_000;
    void updateIfNewer(m).then((reloading) => { if (!reloading) { state = m; void applyAll(); } });
  });
  port.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message;
    port = null;
    problem = why ? `the cinnamon command isn't reachable (${why}); run: cinnamon browser install` : null;
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5 * 60_000);
  });
  port.postMessage({ type: 'hello', version: chrome.runtime.getManifest().version, userScripts: userScriptsUsable() });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const m = msg as { type?: string; msg?: unknown } | null;
  const tabId = sender.tab?.id;
  if (!m || typeof tabId !== 'number' || sender.frameId !== 0 || !(sender.url ?? sender.tab?.url ?? '').startsWith('https://claude.ai/')) return;
  connect();
  if (m.type === 'start') { // a new document in this tab: nothing of ours is in it
    ready.delete(tabId);
    void queue(tabId, async () => { await setCss(tabId, null); await applyCss(tabId); });
  } else if (m.type === 'ready') {
    ready.add(tabId);
    void queue(tabId, async () => { await applyCss(tabId); await applyScripts(tabId); });
  } else if (m.type === 'page') {
    try { port?.postMessage({ type: 'page', msg: m.msg }); } catch {}
  }
});

chrome.tabs.onRemoved.addListener((tabId) => { ready.delete(tabId); queues.delete(tabId); void setCss(tabId, null); });

connect();
