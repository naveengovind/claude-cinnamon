// Types shared by the main-process classes.
import type { FSWatcher } from 'node:fs';
import type { ExtensionRoots } from '../lib/ExtensionCatalog';
import type { ResolvedTheme } from '../lib/ThemeStore';
import type { BrowserWindow, WebContents } from './electron';
import type { ExtensionContext } from './ExtensionContext';

/** The debugger's `require`, kept from before the first await (see core/render.ts). */
export type Load = ((id: string) => any) & { cache: Record<string, unknown> };
export type Log = (...args: unknown[]) => void;
type Timer = ReturnType<typeof setTimeout>;

/** What core/render.ts puts into the script: everything is addressed from Cinnamon's root and the user folder. */
export interface MainConfig {
  root: string;
  userDir: string;
  themeDirs: string[] | null;
  extRoots: ExtensionRoots | null;
  /** argv prefix of the TypeScript compiler (`[<bun>, 'build']`); null = .ts files can't be loaded. */
  compiler: string[] | null;
  /** The core page code (page runtime + Settings rows), already compiled, and its CSS. */
  page: { js: string; css: string };
}

/** What an extension's main part returns from activate(ctx). */
export interface ExtensionInstance {
  onMessage?(msg: string, data: unknown, wc: WebContents): unknown;
  deactivate?(): unknown;
  [key: string]: unknown;
}

/** An enabled extension, read and compiled. `sig`/`cssSig` tell when its page code or css changed. */
export interface LoadedExt {
  page: string[];
  css: string[];
  main: string | null;
  /** The compiled main part when it is TypeScript; null for a .cjs main part (loaded with require). */
  mainCode: string | null;
  errors: string[];
  sig: string;
  cssSig: number;
}

export interface ExtSummary { id: string; name: string; description: string; bundled: boolean; enabled: boolean; error?: string }

export interface CompiledEntry { code: string; inputs: { file: string; stamp: string }[] }

/**
 * `globalThis.__claudeMod`: everything that outlives one apply. Listeners are registered once per app run and call
 * through the functions stored here, so a re-apply replaces the code they run. The field names are shared with
 * every earlier version of the script (and the global's name predates Cinnamon), so they never change.
 */
export interface SharedState {
  // left running by versions before extensions
  watcher?: FSWatcher | null;
  timer?: Timer | null;
  debounce?: Timer | null;
  themeWatchers?: FSWatcher[] | null;
  frameKey?: string | null;

  keys: Map<number, string>; // view id → core css key
  themeKeys: Map<number, string>; // view id → theme css key
  themeApplied: Map<number, string>; // view id → theme css text in place
  extKeys: Map<number, Map<string, string[]>>; // view id → Map(ext id → [css keys])
  ran: Map<number, Map<string, string>>; // view id → Map(ext id → code signature) of page code run since the last load
  dispatchHooked: WeakSet<WebContents>;
  messageHooked: WeakSet<WebContents>;
  mains: Map<string, { instance: ExtensionInstance; ctx: ExtensionContext }>;
  frameKeys: Map<number, string>; // frame view id → css key clearing its background (glass themes)
  lastReload: Map<number, number>;
  queue: Promise<unknown>;
  compileCache: Map<string, CompiledEntry>;

  applyTo?: (wc: WebContents) => Promise<unknown>;
  hook?: (wc: WebContents) => void;
  reloadAll?: () => Promise<unknown>;
  setTheme?: (id: string) => Promise<void>;
  onPageMessage?: (wc: WebContents, args: unknown[]) => Promise<void>;
  wrapWindow?: (win: BrowserWindow) => void;
  dispatchListening?: boolean;
  windowListening?: boolean;

  theme?: ResolvedTheme;
  extList?: ExtSummary[];
  extLoaded?: Map<string, LoadedExt>;
  settings?: Record<string, unknown>;
  windowMaterial?: string | null;
  appMaterials?: WeakMap<BrowserWindow, string | null>;

  watchers?: FSWatcher[];
  reloadDebounce?: Timer | null;
  pollTimer?: Timer | null;
  lastFingerprint?: string;
}
