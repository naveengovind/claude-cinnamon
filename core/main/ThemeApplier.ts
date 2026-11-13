// The selected theme: resolved from config.json and the theme folders, inserted into each claude.ai view as its own
// CSS (separate from the core CSS), and switched when the page picks another one.
import type { Config } from '../lib/Config';
import type { ThemeStore } from '../lib/ThemeStore';
import type { WebContents } from './electron';
import type { Log, SharedState } from './types';

export class ThemeApplier {
  constructor(
    private readonly state: SharedState,
    private readonly store: ThemeStore,
    private readonly config: Config,
    private readonly log: Log,
  ) {}

  load(): void {
    const state = this.state;
    try { state.theme = this.store.resolve(this.config); }
    catch (e) { state.theme = { current: 'default', css: '', window: null, errors: [String(e)], themes: [] }; }
    for (const e of state.theme.errors || []) this.log('theme:', e);
  }

  /** Inserts the new theme css before removing the old one, so the page never flashes the app's own colours. */
  async applyTo(wc: WebContents): Promise<void> {
    const state = this.state;
    const css = state.theme?.css || '';
    if (state.themeApplied.get(wc.id) === css) return;
    const old = state.themeKeys.get(wc.id);
    state.themeKeys.delete(wc.id);
    if (css.trim()) {
      const key = await wc.insertCSS(css).catch(() => null);
      if (key) state.themeKeys.set(wc.id, key);
    }
    if (old) await wc.removeInsertedCSS(old).catch(() => {});
    state.themeApplied.set(wc.id, css);
  }

  /** A pick from the page: saved to config.json if the theme exists, then everything is re-applied. */
  async setTheme(id: string): Promise<void> {
    const known = id === 'default' || (this.state.theme?.themes || []).some((t) => t.id === id && !t.error);
    if (!known) return;
    try { this.config.write({ theme: id }); } catch (e) { this.log('could not save the theme:', e); return; }
    await this.state.reloadAll?.();
  }
}
