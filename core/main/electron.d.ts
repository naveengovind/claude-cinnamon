// The parts of Electron's main-process API Cinnamon uses (hand-written; Electron itself is never a dependency).
// Cinnamon gets the real module from Claude's main process at run time: `load('electron')`.

export interface WebFrameMain { parent: WebFrameMain | null; [key: string]: unknown }

export interface WebContents {
  readonly id: number;
  readonly mainFrame: WebFrameMain;
  isDestroyed(): boolean;
  getURL(): string;
  insertCSS(css: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
  reload(): void;
  on(event: 'dom-ready' | 'destroyed', listener: () => void): this;
  on(event: 'console-message', listener: (...args: unknown[]) => void): this;
}

export interface BrowserWindow {
  isDestroyed?(): boolean;
  setVibrancy(material: string | null, ...rest: unknown[]): void;
  __cinnamonWrapped?: boolean;
}

export interface App {
  getPath(name: 'userData'): string;
  on(event: 'web-contents-created', listener: (event: unknown, wc: WebContents) => void): this;
  on(event: 'browser-window-created', listener: (event: unknown, win: BrowserWindow) => void): this;
}

export interface Electron {
  app: App;
  webContents: { getAllWebContents(): WebContents[] };
  shell: { openPath(path: string): Promise<string> };
  BrowserWindow?: { getAllWindows?(): BrowserWindow[] };
}
