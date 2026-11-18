// The few Chrome extension APIs the Cinnamon extension uses (no @types/chrome dependency).
declare namespace chrome {
  namespace runtime {
    interface Port {
      postMessage(msg: unknown): void;
      disconnect(): void;
      onMessage: { addListener(fn: (msg: unknown) => void): void };
      onDisconnect: { addListener(fn: () => void): void };
    }
    interface MessageSender { tab?: { id?: number; url?: string }; frameId?: number; documentId?: string; url?: string }
    const lastError: { message?: string } | undefined;
    function connectNative(name: string): Port;
    function getManifest(): { version: string };
    function reload(): void;
    function sendMessage(msg: unknown): Promise<unknown>;
    const onMessage: { addListener(fn: (msg: unknown, sender: MessageSender, reply: (r?: unknown) => void) => boolean | void): void };
    const onStartup: { addListener(fn: () => void): void };
    const onInstalled: { addListener(fn: () => void): void };
  }
  namespace tabs {
    interface Tab { id?: number; url?: string; status?: string }
    function query(q: { url?: string | string[] }): Promise<Tab[]>;
    function reload(tabId: number): Promise<void>;
    const onRemoved: { addListener(fn: (tabId: number) => void): void };
  }
  namespace scripting {
    interface Target { tabId: number; frameIds?: number[] }
    interface InjectionResult { result?: unknown; frameId?: number }
    function executeScript(o: { target: Target; world?: 'MAIN' | 'ISOLATED'; func?: (...args: any[]) => unknown; args?: unknown[]; files?: string[]; injectImmediately?: boolean }): Promise<InjectionResult[]>;
    function insertCSS(o: { target: Target; css: string; origin?: 'AUTHOR' | 'USER' }): Promise<void>;
    function removeCSS(o: { target: Target; css: string; origin?: 'AUTHOR' | 'USER' }): Promise<void>;
  }
  /** Present only when the person allowed user scripts for this extension (Developer mode, or Chrome 138+'s toggle). */
  namespace userScripts {
    function execute(o: { target: scripting.Target; world?: 'MAIN' | 'USER_SCRIPT'; js: ({ code: string } | { file: string })[]; injectImmediately?: boolean }): Promise<scripting.InjectionResult[]>;
  }
  namespace storage {
    interface Area { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }
    const session: Area;
    const local: Area;
  }
}
