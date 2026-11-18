// What the Cinnamon browser extension (browser/) and `cinnamon browser-host` say to each other over Chrome's native
// messaging (core/browser/NativeMessaging.ts). Types and constants only: the extension bundles this file too.

/** The native messaging host's name, as Chrome looks it up (lowercase letters, digits, dots and underscores). */
export const HOST_NAME = 'local.claude_cinnamon';
/** The extension's id, fixed by the public key in browser/manifest.json (test/browser.test.ts checks they agree). */
export const EXTENSION_ID = 'jpcdkcbnpgpejelpfpbcogljifdegejf';
/** What the page runtime's dispose returns when it took an extension out (core/page/runtime.ts). */
export const DISPOSED = 'cinnamon:disposed';
/** The tag core/browser/page.ts puts on messages from the page, for the content script. */
export const TO_HOST = 'cinnamon:to-host';

/**
 * An enabled extension that can run in a browser: its page code, as a file in the extension's folder that runs it once
 * per document (core/browser/GenFiles.ts; '' when it has none), and its CSS.
 */
export interface WebExtension { id: string; sig: string; file: string; css: string }

/** An extension as the Settings rows list it. `unavailable`: why it can't run in a browser. */
export interface WebExtSummary { id: string; name: string; description: string; bundled: boolean; enabled: boolean; error?: string; unavailable?: string }

/** Everything the extension puts into claude.ai, sent whole on connect and after every change. */
export interface HostState {
  type: 'state';
  /** Cinnamon's version. */
  version: string;
  /** The version of the extension folder on disk: the extension reloads itself when it runs an older one. */
  extensionVersion: string | null;
  /** Cinnamon's own page code (channel, runtime, Settings rows), as a file in the extension's folder, and its CSS. */
  core: { file: string; css: string };
  theme: { id: string; css: string; themes: { id: string; name: string; description: string; error?: string }[] };
  extensions: WebExtension[];
  extList: WebExtSummary[];
  settings: Record<string, unknown>;
}

/** From the extension. `page`: a message from claude.ai's page (the runtime or the Settings rows). */
export type ToHost =
  | { type: 'hello'; version: string; userScripts: boolean }
  | { type: 'status'; userScripts: boolean; problem: string | null }
  | { type: 'page'; msg: unknown };
