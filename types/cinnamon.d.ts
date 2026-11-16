// The `cinnamon` object an extension's page code gets (see core/page/runtime.ts). Extension authors can reference
// this file for types: /// <reference path="…/types/cinnamon.d.ts" />
declare const cinnamon: {
  readonly id: string;
  /** Sends a message to the extension's main part (bundled extensions only). */
  send(msg: string, data?: unknown): void;
  /** This extension's settings, saved in ~/.config/claude-cinnamon/config.json. */
  settings: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    all(): Record<string, unknown>;
    onChange(fn: (settings: Record<string, unknown>) => void): void;
  };
  /**
   * Clean-up for when the extension is taken out of the page: disconnect observers, clear timers, remove listeners
   * and elements you added. An extension that registers clean-up is hot-reloaded: when its code changes or it is
   * turned off, Cinnamon runs this and swaps it in place instead of reloading Claude's window.
   */
  onDispose(fn: () => void): void;
};
