// The theme folders: bundled (themes/ in Cinnamon) and the user's (~/.config/claude-cinnamon/themes/). A later folder
// overrides the same id. Used by the CLI and the main process. No Electron.
import fs from 'node:fs';
import path from 'node:path';
import { Config } from './Config';
import { ThemeEngine, type Theme, type WindowOptions } from './ThemeEngine';

export interface ThemeEntry {
  id: string;
  name: string;
  description: string;
  file: string;
  theme?: Theme;
  error?: string;
}
export interface ThemeSummary { id: string; name: string; description: string; error?: string }
/** The configured theme, ready to apply. */
export interface ResolvedTheme {
  current: string;
  css: string;
  window: WindowOptions | null;
  errors: string[];
  themes: ThemeSummary[];
}

export class ThemeStore {
  constructor(readonly dirs: readonly string[]) {}

  /** Themes in the folders (later folders override the same id), sorted by name. */
  list(): ThemeEntry[] {
    const byId = new Map<string, ThemeEntry>();
    for (const dir of this.dirs) {
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const f of files) {
        const id = f.slice(0, -5);
        if (id === 'default') continue; // "Default" always means Claude's own colours
        const file = path.join(dir, f);
        try {
          const t = JSON.parse(fs.readFileSync(file, 'utf8')) as Theme;
          if (!t || typeof t !== 'object') throw new Error('not an object');
          byId.set(id, { id, name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : id, description: typeof t.description === 'string' ? t.description : '', file, theme: t });
        } catch (e) {
          byId.set(id, { id, name: id, description: '', file, error: String((e as Error).message || e) });
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The theme the config picks: { current, css, window, errors, themes }. */
  resolve(config: Config): ResolvedTheme {
    const themes = this.list();
    const want = config.read().theme;
    const found = themes.find((t) => t.id === want && !t.error);
    const { css, errors } = found ? ThemeEngine.css(found.theme) : { css: '', errors: [] as string[] };
    return {
      current: found ? found.id : 'default',
      css,
      window: found ? ThemeEngine.windowOptions(found.theme, errors) : null,
      errors,
      themes: themes.map(({ id, name, description, error }) => ({ id, name, description, ...(error ? { error } : {}) })),
    };
  }
}

export const listThemes = (dirs: readonly string[]): ThemeEntry[] => new ThemeStore(dirs).list();
export const resolveTheme = (dirs: readonly string[], configFile: string): ResolvedTheme => new ThemeStore(dirs).resolve(new Config(configFile));
