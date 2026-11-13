// Cinnamon page runtime: the small API every extension's page code gets as `cinnamon`. Runs in the claude.ai page
// before any extension. Messages go to the main process as console messages prefixed "[cinnamon] ".
//   cinnamon.send(type, data)           → the extension's main part (bundled extensions) receives it
//   cinnamon.settings.get(key) / .set(key, value) / .all() / .onChange(fn)
//                                        → per-extension settings, saved in ~/.config/claude-cinnamon/config.json
// Loading it again (each apply) keeps the settings and listeners it had.

type Settings = Record<string, unknown>;
type Listener = (settings: Settings) => void;

interface PageWindow { __cinnamon?: CinnamonRuntime }
const page = window as unknown as PageWindow;
/** Always the runtime loaded most recently, so api objects handed out earlier never use a stale one. */
const current = (): CinnamonRuntime => page.__cinnamon!;

class ExtensionSettings {
  constructor(private readonly id: string) {}
  get(key: string): unknown { return (current().settings[this.id] || {})[key]; }
  all(): Settings { return { ...(current().settings[this.id] || {}) }; }
  set(key: string, value: unknown): void {
    const rt = current();
    (rt.settings[this.id] ??= {})[key] = value;
    rt.send({ type: 'ext-setting', ext: this.id, key, value });
    rt.notify(this.id);
  }
  onChange(fn: Listener): void { if (typeof fn === 'function') (current().listeners[this.id] ??= []).push(fn); }
}

class ExtensionApi {
  readonly settings: ExtensionSettings;
  constructor(readonly id: string) { this.settings = new ExtensionSettings(id); }
  send(msg: string, data?: unknown): void { current().send({ type: 'ext', ext: this.id, msg, data }); }
}

class CinnamonRuntime {
  settings: Record<string, Settings>;
  listeners: Record<string, Listener[]>;

  constructor(previous?: Partial<CinnamonRuntime>) {
    this.settings = previous?.settings ?? {};
    this.listeners = previous?.listeners ?? {};
  }

  send(msg: unknown): void { try { console.debug(`[cinnamon] ${JSON.stringify(msg)}`); } catch {} }

  notify(id: string): void {
    for (const fn of this.listeners[id] || []) { try { fn({ ...(this.settings[id] || {}) }); } catch {} }
  }

  setSettings(all: unknown): void {
    this.settings = all && typeof all === 'object' ? (all as Record<string, Settings>) : {};
    for (const id of Object.keys(this.listeners)) this.notify(id);
  }

  reset(id: string): void { this.listeners[id] = []; }

  api(id: string): ExtensionApi { return new ExtensionApi(id); }
}

page.__cinnamon = new CinnamonRuntime(page.__cinnamon);

export {}; // a module: its names stay its own (Bun wraps it for the page)
