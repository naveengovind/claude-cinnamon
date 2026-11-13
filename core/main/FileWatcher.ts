// Watches the theme folders, the extension folders and config.json, and calls `onChange` (debounced) when anything
// changes. File-change events can be dropped (macOS especially), so a cheap fingerprint (names, sizes, times) is
// also compared every few seconds. Watchers and timers live in the shared state and are replaced on each apply.
import fs from 'node:fs';
import path from 'node:path';
import type { ExtensionRoots } from '../lib/ExtensionCatalog';
import type { Log, SharedState } from './types';

const DEBOUNCE_MS = 250;
const POLL_MS = 4000;

export class FileWatcher {
  constructor(
    private readonly state: SharedState,
    private readonly themeDirs: readonly string[],
    private readonly extRoots: ExtensionRoots,
    private readonly configPath: string,
    private readonly log: Log,
  ) {}

  /** A fingerprint of everything that can change what Cinnamon applies. */
  fingerprint(): string {
    const parts: string[] = [];
    const stat = (f: string) => { try { const st = fs.statSync(f); parts.push(`${f}:${st.size}:${st.mtimeMs}`); } catch { parts.push(`${f}:-`); } };
    const list = (d: string) => { try { return fs.readdirSync(d); } catch { return []; } };
    stat(this.configPath);
    for (const d of this.themeDirs) for (const f of list(d)) stat(path.join(d, f));
    for (const root of [this.extRoots.bundled, this.extRoots.user]) for (const e of list(root)) for (const f of list(path.join(root, e))) stat(path.join(root, e, f));
    return parts.join('|');
  }

  start(onChange: () => Promise<unknown> | unknown): void {
    const state = this.state;
    this.stop();
    for (const d of [this.themeDirs[this.themeDirs.length - 1]!, this.extRoots.user, path.dirname(this.configPath)]) {
      try { fs.mkdirSync(d, { recursive: true }); } catch {}
    }
    const changed = () => {
      if (state.reloadDebounce) clearTimeout(state.reloadDebounce);
      state.reloadDebounce = setTimeout(() => {
        try { state.lastFingerprint = this.fingerprint(); } catch {}
        Promise.resolve(onChange()).catch((e) => this.log(e));
      }, DEBOUNCE_MS);
    };
    const watch = (dir: string, opts: fs.WatchOptions, only?: string) => {
      try {
        const w = fs.watch(dir, opts, (_ev, name) => { if (!only || name === only) changed(); });
        w.on('error', () => {});
        state.watchers!.push(w);
      } catch {}
    };
    for (const d of this.themeDirs) watch(d, {});
    for (const d of [this.extRoots.bundled, this.extRoots.user]) watch(d, { recursive: true });
    watch(path.dirname(this.configPath), {}, path.basename(this.configPath));

    state.lastFingerprint = this.fingerprint();
    state.pollTimer = setInterval(() => {
      const now = this.fingerprint();
      if (now !== state.lastFingerprint) { state.lastFingerprint = now; changed(); }
    }, POLL_MS);
  }

  stop(): void {
    const state = this.state;
    for (const w of state.watchers || []) { try { w.close(); } catch {} }
    state.watchers = [];
    if (state.reloadDebounce) clearTimeout(state.reloadDebounce);
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.reloadDebounce = null;
    state.pollTimer = null;
  }
}
