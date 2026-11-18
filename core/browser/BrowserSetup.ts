// Sets up Cinnamon for claude.ai in a Chromium browser (`cinnamon browser install | list | uninstall`), optional and
// separate from the desktop app's setup:
//   <your folder>/browser/extension/   the Cinnamon extension, built from browser/: load it once from the browser's
//                                      extensions page → Developer mode → Load unpacked. Updates rebuild this folder in
//                                      place and the extension reloads itself, so it never goes through a web store.
//                                      Its gen/ folder holds the page code the host writes for it (BrowserHost).
//   <your folder>/browser/cinnamon-host  what the browser starts for the extension: runs `cinnamon browser-host`
//   <your folder>/browser/browsers.json  which browsers Cinnamon is set up in (two can read the same host manifest)
//   …/NativeMessagingHosts/local.claude_cinnamon.json  tells each browser picked with --browser (Chrome, Arc, Brave,
//                                      Edge, Chromium, Vivaldi) where that program is, for this extension only
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_ID, HOST_NAME } from './protocol';

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A Chromium browser Cinnamon can be set up in: its id (for `--browser`), its app, its user data folder under
 * ~/Library/Application Support (`support`), the folder whose NativeMessagingHosts it reads (`nativeMessaging`), and
 * its extensions page.
 */
export interface BrowserInfo { id: string; name: string; app: string; support: string; nativeMessaging: string; extensionsUrl: string }

/**
 * In this order: the first installed one is the default when Chrome isn't installed. Ids are stable (scripts use them).
 * Chromium looks for native messaging hosts in <its user data folder>/NativeMessagingHosts, and Brave, Edge, Chromium and
 * Vivaldi each have their own. Arc is the odd one: it reads Google Chrome's folder, not its own. Seen in Arc 1.173.1:
 * connectNative("local.claude_cinnamon") said "Specified native messaging host not found." with the manifest in
 * Arc/User Data/NativeMessagingHosts (and in Arc/NativeMessagingHosts), and Arc started the host at once with the same
 * manifest in Google/Chrome/NativeMessagingHosts.
 */
export const BROWSERS: readonly BrowserInfo[] = [
  { id: 'chrome', name: 'Google Chrome', app: 'Google Chrome', support: 'Google/Chrome', nativeMessaging: 'Google/Chrome', extensionsUrl: 'chrome://extensions' },
  { id: 'arc', name: 'Arc', app: 'Arc', support: 'Arc/User Data', nativeMessaging: 'Google/Chrome', extensionsUrl: 'arc://extensions' },
  { id: 'brave', name: 'Brave', app: 'Brave Browser', support: 'BraveSoftware/Brave-Browser', nativeMessaging: 'BraveSoftware/Brave-Browser', extensionsUrl: 'brave://extensions' },
  { id: 'edge', name: 'Microsoft Edge', app: 'Microsoft Edge', support: 'Microsoft Edge', nativeMessaging: 'Microsoft Edge', extensionsUrl: 'edge://extensions' },
  { id: 'chromium', name: 'Chromium', app: 'Chromium', support: 'Chromium', nativeMessaging: 'Chromium', extensionsUrl: 'chrome://extensions' },
  { id: 'vivaldi', name: 'Vivaldi', app: 'Vivaldi', support: 'Vivaldi', nativeMessaging: 'Vivaldi', extensionsUrl: 'chrome://extensions' },
];

/** A browser on this Mac: whether its app is installed and whether Cinnamon is set up in it. */
export interface BrowserState extends BrowserInfo {
  installed: boolean;
  /** Cinnamon is set up in this browser: on record, and its host manifest is where the browser reads it. */
  registered: boolean;
  /** The host manifest the browser reads (Arc's is Chrome's). */
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
  /** URL match patterns the extension works on; default claude.ai (a test build points it elsewhere). */
  matches?: string[];
  log?: (line: string) => void;
}

/** The folder of page code the host writes into the extension (kept when the extension is rebuilt). */
export const GEN_DIR = 'gen';

export class BrowserSetup {
  private readonly log: (line: string) => void;
  constructor(private readonly o: BrowserSetupOptions) { this.log = o.log ?? ((l) => console.log(l)); }

  get dir(): string { return path.join(this.o.userDir, 'browser'); }
  get extensionDir(): string { return path.join(this.dir, 'extension'); }
  get hostScript(): string { return path.join(this.dir, 'cinnamon-host'); }
  get registryFile(): string { return path.join(this.dir, 'browsers.json'); }
  get manifestName(): string { return `${HOST_NAME}.json`; }
  private get support(): string { return path.join(this.o.home, 'Library', 'Application Support'); }

  /** The browsers on record, or null for a setup from before the record (0.4.0). */
  private registry(): string[] | null {
    try {
      const r = JSON.parse(fs.readFileSync(this.registryFile, 'utf8')) as { browsers?: unknown };
      return Array.isArray(r.browsers) ? r.browsers.filter((x): x is string => typeof x === 'string') : null;
    } catch { return null; }
  }

  private writeRegistry(ids: readonly string[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.registryFile, `${JSON.stringify({ browsers: [...ids] }, null, 2)}\n`);
  }

  /** Where a browser's own NativeMessagingHosts folder would hold the manifest (where 0.4.0 put it, Arc's included). */
  private ownManifest(b: BrowserInfo): string { return path.join(this.support, b.support, 'NativeMessagingHosts', this.manifestName); }

  /** Every supported browser, with whether it is installed here and whether Cinnamon is set up in it. */
  browsers(): BrowserState[] {
    const appDirs = this.o.applications ?? ['/Applications', path.join(this.o.home, 'Applications')];
    const record = this.registry();
    return BROWSERS.map((b) => {
      const appPath = appDirs.map((d) => path.join(d, `${b.app}.app`)).find((p) => fs.existsSync(p)) ?? null;
      const hostManifest = path.join(this.support, b.nativeMessaging, 'NativeMessagingHosts', this.manifestName);
      // before the record: a browser was set up when its own folder had the manifest
      const registered = record ? record.includes(b.id) && BrowserSetup.isOurs(hostManifest) : BrowserSetup.isOurs(this.ownManifest(b));
      return { ...b, installed: !!appPath, registered, hostManifest, appPath };
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
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')) as Record<string, any>;
    if (this.o.matches) {
      manifest.host_permissions = this.o.matches;
      for (const cs of manifest.content_scripts) cs.matches = this.o.matches;
    }
    manifest.version = extensionVersion(this.o.version, JSON.stringify([out, manifest]));
    out['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.mkdirSync(path.join(this.extensionDir, GEN_DIR), { recursive: true });
    // the manifest last: the host reads its version to tell the running extension to reload
    for (const [f, text] of Object.entries(out).sort(([a], [b]) => (a === 'manifest.json' ? 1 : b === 'manifest.json' ? -1 : 0))) {
      const file = path.join(this.extensionDir, f);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
    }
    for (const f of fs.readdirSync(this.extensionDir)) if (!(f in out) && f !== GEN_DIR) fs.rmSync(path.join(this.extensionDir, f), { recursive: true, force: true });
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

  /**
   * Sets Cinnamon up in exactly these browsers: the host program, its manifest where each reads it, and the record.
   * Manifests 0.4.0 left where a browser doesn't read them (Arc's own folder) go.
   */
  writeHost(ids: readonly string[]): string[] {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.hostScript, this.hostScriptText(), { mode: 0o755 });
    fs.chmodSync(this.hostScript, 0o755);
    const all = this.browsers();
    const picked = all.filter((b) => ids.includes(b.id));
    for (const file of new Set(picked.map((b) => b.hostManifest))) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(this.hostManifest(), null, 2)}\n`);
    }
    this.removeStrayManifests(new Set(picked.map((b) => b.hostManifest)));
    this.writeRegistry(picked.map((b) => b.id));
    return picked.map((b) => b.id);
  }

  /** Cinnamon's manifests in a browser's own folder that no browser set up reads (only Arc's, today). */
  private removeStrayManifests(keep: Set<string>): string[] {
    const removed: string[] = [];
    for (const b of BROWSERS) {
      const own = this.ownManifest(b);
      if (own === path.join(this.support, b.nativeMessaging, 'NativeMessagingHosts', this.manifestName) || keep.has(own)) continue;
      if (BrowserSetup.isOurs(own)) { fs.rmSync(own, { force: true }); removed.push(own); }
    }
    return removed;
  }

  /** Builds the extension and sets it up in this browser (and again in any it is set up in already). */
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
   * Takes Cinnamon out of these browsers. A manifest two browsers read (Chrome's, which Arc reads too) stays while one
   * of them is still set up. `all`, or once no browser is left: the extension folder and host program go too. Only
   * Cinnamon's own manifests are removed. Returns what was removed.
   */
  uninstall(ids: readonly string[] | 'all'): string[] {
    const all = this.browsers();
    const leaving = all.filter((b) => b.registered && (ids === 'all' || ids.includes(b.id)));
    const staying = all.filter((b) => b.registered && !leaving.includes(b));
    const removed: string[] = [];
    for (const file of new Set(leaving.map((b) => b.hostManifest))) {
      if (staying.some((b) => b.hostManifest === file) || !BrowserSetup.isOurs(file)) continue;
      fs.rmSync(file, { force: true });
      removed.push(file);
    }
    removed.push(...this.removeStrayManifests(new Set(staying.map((b) => b.hostManifest))));
    if (ids === 'all' || !staying.length) {
      if (fs.existsSync(this.dir)) { fs.rmSync(this.dir, { recursive: true, force: true }); removed.push(this.dir); }
    } else {
      this.writeRegistry(staying.map((b) => b.id));
    }
    return removed;
  }
}
