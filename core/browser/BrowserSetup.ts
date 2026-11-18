// Sets up Cinnamon for claude.ai in a Chromium browser (`cinnamon browser install | list | uninstall`), optional and
// separate from the desktop app's setup:
//   <your folder>/browser/extension/   the Cinnamon extension, built from browser/: load it once from the browser's
//                                      extensions page → Developer mode → Load unpacked. Updates rebuild this folder in
//                                      place and the extension reloads itself, so it never goes through a web store.
//   <your folder>/browser/cinnamon-host  what the browser starts for the extension: runs `cinnamon browser-host`
//   …/NativeMessagingHosts/local.claude_cinnamon.json  tells each browser picked with --browser (Chrome, Arc, Brave,
//                                      Edge, Chromium, Vivaldi) where that program is, for this extension only
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_ID, HOST_NAME } from './protocol';

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** A Chromium browser Cinnamon can be set up in: its id (for `--browser`), its app, where it keeps its user data under
 *  ~/Library/Application Support (native messaging hosts go in its NativeMessagingHosts folder) and its extensions page. */
export interface BrowserInfo { id: string; name: string; app: string; support: string; extensionsUrl: string }

/** In this order: the first installed one is the default when Chrome isn't installed. Ids are stable (scripts use them). */
export const BROWSERS: readonly BrowserInfo[] = [
  { id: 'chrome', name: 'Google Chrome', app: 'Google Chrome', support: 'Google/Chrome', extensionsUrl: 'chrome://extensions' },
  { id: 'arc', name: 'Arc', app: 'Arc', support: 'Arc/User Data', extensionsUrl: 'arc://extensions' },
  { id: 'brave', name: 'Brave', app: 'Brave Browser', support: 'BraveSoftware/Brave-Browser', extensionsUrl: 'brave://extensions' },
  { id: 'edge', name: 'Microsoft Edge', app: 'Microsoft Edge', support: 'Microsoft Edge', extensionsUrl: 'edge://extensions' },
  { id: 'chromium', name: 'Chromium', app: 'Chromium', support: 'Chromium', extensionsUrl: 'chrome://extensions' },
  { id: 'vivaldi', name: 'Vivaldi', app: 'Vivaldi', support: 'Vivaldi', extensionsUrl: 'chrome://extensions' },
];

/** A browser on this Mac: whether its app is installed and whether Cinnamon's host is registered in it. */
export interface BrowserState extends BrowserInfo {
  installed: boolean;
  /** Cinnamon's host manifest is in the browser's NativeMessagingHosts folder. */
  registered: boolean;
  /** Where that manifest goes. */
  hostManifest: string;
  /** The app's path, when installed. */
  appPath: string | null;
}

/** Chrome's id for an extension: the first 128 bits of the SHA-256 of its public key, as letters a–p. */
export function extensionIdOf(publicKeyBase64: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/**
 * The extension's version: Cinnamon's (three numbers) and a fourth from its built files, so any change (a release,
 * or an edit in a development checkout) gives a new version, which is what makes the extension reload itself.
 */
export function extensionVersion(cinnamonVersion: string, built: string): string {
  const nums = (cinnamonVersion.match(/\d+/g) ?? []).slice(0, 3).map((n) => String(Math.min(65535, Number(n))));
  while (nums.length < 3) nums.push('0');
  const h = parseInt(createHash('sha256').update(built).digest('hex').slice(0, 8), 16) % 65535;
  return `${nums.join('.')}.${h + 1}`;
}

export interface BrowserSetupOptions {
  root: string;
  userDir: string;
  home: string;
  version: string;
  /** The standalone binary; else the install's bin/cinnamon runs with Bun. */
  binary?: string | null;
  /** Where apps are looked for; default /Applications and ~/Applications. */
  applications?: string[];
  log?: (line: string) => void;
}

export class BrowserSetup {
  private readonly log: (line: string) => void;
  constructor(private readonly o: BrowserSetupOptions) { this.log = o.log ?? ((l) => console.log(l)); }

  get dir(): string { return path.join(this.o.userDir, 'browser'); }
  get extensionDir(): string { return path.join(this.dir, 'extension'); }
  get hostScript(): string { return path.join(this.dir, 'cinnamon-host'); }
  get manifestName(): string { return `${HOST_NAME}.json`; }

  /** Every supported browser, with whether it is installed here and whether Cinnamon's host is registered in it. */
  browsers(): BrowserState[] {
    const support = path.join(this.o.home, 'Library', 'Application Support');
    const appDirs = this.o.applications ?? ['/Applications', path.join(this.o.home, 'Applications')];
    return BROWSERS.map((b) => {
      const appPath = appDirs.map((d) => path.join(d, `${b.app}.app`)).find((p) => fs.existsSync(p)) ?? null;
      const hostManifest = path.join(support, b.support, 'NativeMessagingHosts', this.manifestName);
      return { ...b, installed: !!appPath, registered: BrowserSetup.isOurs(hostManifest), hostManifest, appPath };
    });
  }

  /** Chrome when it is installed, else the first installed browser; null when there is none. */
  defaultBrowser(): BrowserState | null {
    const all = this.browsers().filter((b) => b.installed);
    return all.find((b) => b.id === 'chrome') ?? all[0] ?? null;
  }

  /** The browser `--browser <id>` names (or the default): an installed one, else why not. */
  pick(id?: string | null): BrowserState | string {
    if (!id) return this.defaultBrowser() ?? `no supported browser found (${BROWSERS.map((b) => b.name).join(', ')})`;
    const b = this.browsers().find((x) => x.id === id.toLowerCase());
    if (!b) return `unknown browser "${id}" (one of: ${BROWSERS.map((x) => x.id).join(', ')})`;
    if (!b.installed) return `${b.name} isn't installed (no ${b.app}.app in /Applications or ~/Applications)`;
    return b;
  }

  private static isOurs(file: string): boolean {
    try { return (JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown }).name === HOST_NAME; } catch { return false; }
  }

  installed(): boolean { return fs.existsSync(path.join(this.extensionDir, 'manifest.json')); }

  /** Builds the extension from browser/ into its folder, in place (the browser keeps loading it from the same path). */
  async build(): Promise<string> {
    const src = path.join(this.o.root, 'browser');
    const out: Record<string, string> = {};
    for (const name of ['background', 'content']) {
      const r = await Bun.build({ entrypoints: [path.join(src, `${name}.ts`)], target: 'browser', format: 'iife' });
      if (!r.success) throw new Error(`could not build the browser extension (${name}):\n${r.logs.join('\n')}`);
      out[`${name}.js`] = await r.outputs[0]!.text();
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    manifest.version = extensionVersion(this.o.version, JSON.stringify([out, manifest]));
    out['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.mkdirSync(this.extensionDir, { recursive: true });
    // the manifest last: the host reads its version to tell the running extension to reload
    for (const [f, text] of Object.entries(out).sort(([a], [b]) => (a === 'manifest.json' ? 1 : b === 'manifest.json' ? -1 : 0))) {
      const file = path.join(this.extensionDir, f);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
    }
    for (const f of fs.readdirSync(this.extensionDir)) if (!(f in out)) fs.rmSync(path.join(this.extensionDir, f), { recursive: true, force: true });
    return manifest.version as string;
  }

  hostScriptText(): string {
    const { o } = this;
    const env = o.binary
      ? `export CINNAMON_BIN=${shQuote(o.binary)}`
      : `export CINNAMON_ROOT=${shQuote(o.root)}`;
    const run = o.binary ? shQuote(o.binary) : shQuote(path.join(o.root, 'bin', 'cinnamon'));
    return `#!/bin/sh
# Started by the browser for the Cinnamon extension (written by \`cinnamon browser install\`): Cinnamon's side of the
# connection. It reads and writes only Cinnamon's own folder.
export CINNAMON_HOME=${shQuote(o.userDir)}
${env}
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"
exec ${run} browser-host "$@"
`;
  }

  hostManifest(): Record<string, unknown> {
    return {
      name: HOST_NAME,
      description: 'Cinnamon: themes and extensions for Claude',
      path: this.hostScript,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    };
  }

  /** The host program, and its manifest in each of these browsers (rewritten each time: paths change with updates). */
  writeHost(ids: readonly string[]): string[] {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.hostScript, this.hostScriptText(), { mode: 0o755 });
    fs.chmodSync(this.hostScript, 0o755);
    const written: string[] = [];
    for (const b of this.browsers()) {
      if (!ids.includes(b.id)) continue;
      fs.mkdirSync(path.dirname(b.hostManifest), { recursive: true });
      fs.writeFileSync(b.hostManifest, `${JSON.stringify(this.hostManifest(), null, 2)}\n`);
      written.push(b.id);
    }
    return written;
  }

  /** Builds the extension and registers the host in this browser (and again in any it is registered in already). */
  async install(id: string): Promise<{ version: string; browsers: string[] }> {
    const version = await this.build();
    const ids = [id, ...this.browsers().filter((b) => b.registered && b.id !== id).map((b) => b.id)];
    return { version, browsers: this.writeHost(ids) };
  }

  /** After an update: rebuilds the folder and the host where the browser part is set up, else does nothing. */
  async refresh(): Promise<string | null> {
    if (!this.installed()) return null;
    const version = await this.build();
    this.writeHost(this.browsers().filter((b) => b.registered).map((b) => b.id));
    return version;
  }

  /**
   * Unregisters the host from these browsers. `all`: from every one, and the extension folder and host program go too
   * (as they do once no browser is left). Only Cinnamon's own manifests are removed. Returns what was removed.
   */
  uninstall(ids: readonly string[] | 'all'): string[] {
    const removed: string[] = [];
    for (const b of this.browsers()) {
      if (!b.registered || (ids !== 'all' && !ids.includes(b.id))) continue;
      fs.rmSync(b.hostManifest, { force: true });
      removed.push(b.hostManifest);
    }
    if ((ids === 'all' || !this.browsers().some((b) => b.registered)) && fs.existsSync(this.dir)) {
      fs.rmSync(this.dir, { recursive: true, force: true });
      removed.push(this.dir);
    }
    return removed;
  }
}
