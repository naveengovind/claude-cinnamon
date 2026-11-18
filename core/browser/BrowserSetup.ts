// Sets up Cinnamon for claude.ai in Chrome (`cinnamon browser install | uninstall`), optional and separate from the
// desktop app's setup:
//   <your folder>/browser/extension/   the Cinnamon extension, built from browser/: load it once with chrome://extensions
//                                      → Developer mode → Load unpacked. Updates rebuild this folder in place and the
//                                      extension reloads itself, so it never goes through a web store.
//   <your folder>/browser/cinnamon-host  what Chrome starts for the extension: runs `cinnamon browser-host`
//   …/NativeMessagingHosts/local.claude_cinnamon.json  tells Chrome (and Chrome Beta, Chromium, Brave, Edge, Arc when
//                                      installed) where that program is, for this extension only
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_ID, HOST_NAME } from './protocol';

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The browsers whose NativeMessagingHosts folder gets the host manifest: Chrome always, the others when installed. */
export const BROWSERS: readonly { name: string; dir: string; always?: boolean }[] = [
  { name: 'Google Chrome', dir: 'Google/Chrome', always: true },
  { name: 'Chrome Beta', dir: 'Google/Chrome Beta' },
  { name: 'Chrome Canary', dir: 'Google/Chrome Canary' },
  { name: 'Chromium', dir: 'Chromium' },
  { name: 'Brave', dir: 'BraveSoftware/Brave-Browser' },
  { name: 'Microsoft Edge', dir: 'Microsoft Edge' },
  { name: 'Arc', dir: 'Arc/User Data' },
];

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
  log?: (line: string) => void;
}

export class BrowserSetup {
  private readonly log: (line: string) => void;
  constructor(private readonly o: BrowserSetupOptions) { this.log = o.log ?? ((l) => console.log(l)); }

  get dir(): string { return path.join(this.o.userDir, 'browser'); }
  get extensionDir(): string { return path.join(this.dir, 'extension'); }
  get hostScript(): string { return path.join(this.dir, 'cinnamon-host'); }
  get manifestName(): string { return `${HOST_NAME}.json`; }

  /** Where each browser looks for this host's manifest; `present`: the browser is installed (or it's Chrome). */
  hostManifests(): { name: string; file: string; present: boolean }[] {
    const support = path.join(this.o.home, 'Library', 'Application Support');
    return BROWSERS.map((b) => ({
      name: b.name,
      file: path.join(support, b.dir, 'NativeMessagingHosts', this.manifestName),
      present: !!b.always || fs.existsSync(path.join(support, b.dir)),
    }));
  }

  installed(): boolean { return fs.existsSync(path.join(this.extensionDir, 'manifest.json')); }

  /** Builds the extension from browser/ into its folder, in place (Chrome keeps loading it from the same path). */
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
# Started by Chrome for the Cinnamon extension (written by \`cinnamon browser install\`): Cinnamon's side of the
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

  /** The host program and the manifests that point browsers to it (rewritten each time: paths change with updates). */
  writeHost(): string[] {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.hostScript, this.hostScriptText(), { mode: 0o755 });
    fs.chmodSync(this.hostScript, 0o755);
    const written: string[] = [];
    for (const m of this.hostManifests()) {
      if (!m.present) continue;
      fs.mkdirSync(path.dirname(m.file), { recursive: true });
      fs.writeFileSync(m.file, `${JSON.stringify(this.hostManifest(), null, 2)}\n`);
      written.push(m.name);
    }
    return written;
  }

  async install(): Promise<{ version: string; browsers: string[] }> {
    const version = await this.build();
    const browsers = this.writeHost();
    return { version, browsers };
  }

  /** After an update: rebuilds the folder and the host if the browser part is set up, else does nothing. */
  async refresh(): Promise<string | null> {
    if (!this.installed()) return null;
    const { version } = await this.install();
    return version;
  }

  /** Removes the extension folder, the host program and every host manifest that is Cinnamon's. */
  uninstall(): string[] {
    const removed: string[] = [];
    for (const m of this.hostManifests()) {
      try {
        const j = JSON.parse(fs.readFileSync(m.file, 'utf8')) as { name?: unknown };
        if (j.name !== HOST_NAME) continue;
        fs.rmSync(m.file, { force: true });
        removed.push(m.file);
      } catch {}
    }
    if (fs.existsSync(this.dir)) { fs.rmSync(this.dir, { recursive: true, force: true }); removed.push(this.dir); }
    return removed;
  }
}
