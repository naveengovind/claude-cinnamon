// cinnamon browser install [--browser <id>] | list [--json] | uninstall [--browser <id> | --all] | status, and
// `cinnamon browser-host` (what the browser starts for the extension).
//
// `cinnamon browser list --json` is read by other programs (the menu bar app's browser picker); its shape is stable:
//   { "schema": 1, "extensionId": "…", "extensionDir": "…", "extensionBuilt": bool, "default": "<id>" | null,
//     "browsers": [ { "id", "name", "installed": bool, "registered": bool, "extensionsUrl", "hostManifest" } ] }
// with every supported browser, in a fixed order. New fields may be added; none are renamed or removed.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { BrowserHost } from '../browser/BrowserHost';
import { BROWSERS, BrowserSetup, type BrowserState } from '../browser/BrowserSetup';
import { Presence, type BrowserLink } from '../lib/Presence';
import { EXTENSION_ID } from '../browser/protocol';
import { defaultCompiler } from '../render';
import type { Output } from './Output';
import type { Paths } from './Paths';

export interface BrowserCommandsOptions {
  home?: string;
  /** Where apps are looked for (tests); default /Applications and ~/Applications. */
  applications?: string[];
  /** Opens a URL in an app (`open -a <app> <url>`); a test passes its own. */
  openApp?: (app: string, url: string) => void;
  /** Puts text on the clipboard. */
  copy?: (text: string) => void;
  /** Shows a folder selected in Finder (`open -R`), to drag onto the extensions page. */
  reveal?: (dir: string) => void;
}

/** The value of `--name <v>` or `--name=<v>` in args, or null. */
function flag(args: readonly string[], name: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === `--${name}`) return args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : '';
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return null;
}

export class BrowserCommands {
  readonly setup: BrowserSetup;

  constructor(private readonly paths: Paths, private readonly out: Output, private readonly opts: BrowserCommandsOptions = {}) {
    this.setup = new BrowserSetup({
      root: paths.root, userDir: paths.user, home: opts.home ?? os.homedir(), version: paths.version, binary: paths.binary,
      ...(opts.applications ? { applications: opts.applications } : {}), log: (l) => out.say(l),
    });
  }

  /** `cinnamon browser <sub> …`: args are everything after `browser` (`json`: the CLI took --json out of them). */
  run(args: readonly string[], { json = false } = {}): Promise<number> | number {
    const [sub, ...rest] = args;
    switch (sub ?? 'status') {
      case 'install': return this.install(flag(rest, 'browser'), { open: !rest.includes('--no-open') });
      case 'list': return this.list(json || rest.includes('--json'));
      case 'uninstall': {
        const id = flag(rest, 'browser');
        return this.uninstall(rest.includes('--all') || id === null ? 'all' : id);
      }
      case 'status': return this.status();
      default: return this.out.fail(`unknown: cinnamon browser ${sub} (install, list, uninstall, status)`);
    }
  }

  async install(id: string | null, { open = true } = {}): Promise<number> {
    const { out, setup } = this;
    if (id === '') return out.fail('usage: cinnamon browser install [--browser <id>]');
    const b = setup.pick(id);
    if (typeof b === 'string') return out.fail(b);
    const was = setup.installed();
    let r: { version: string; browsers: string[] };
    try { r = await setup.install(b.id); } catch (e) { return out.fail(String((e as Error).message || e)); }
    out.say(`${out.green('✓')} Cinnamon extension ${r.version} built in ${setup.extensionDir}`);
    out.say(`${out.green('✓')} ${b.name} can start Cinnamon for it`);
    const status = BrowserHost.readStatus(this.paths.user);
    if (was && status.connected && b.registered) {
      out.say('Updated in place: the extension reloads itself into this version the next time it connects.');
      return 0;
    }
    out.say(`
${out.bold(`One-time setup in ${b.name}`)} (${b.extensionsUrl}${open ? ', opening now' : ''}):
  1. Turn on ${out.bold('Developer mode')}.
  2. Drag the ${out.bold('extension')} folder${open ? ' Finder is showing' : ''} onto that page and drop it.
     (Or click ${out.bold('Load unpacked')} and pick it: press ⌘⇧G in the picker and paste the path${open ? ', already copied' : ''}.)
       ${setup.extensionDir}
Then open claude.ai: Settings → Appearance has Cinnamon's rows, as in the desktop app. Themes, extensions and settings
are shared with the desktop app. ${out.dim(`(extension id ${EXTENSION_ID})`)}
Updates come with ${out.bold('cinnamon update')}; the extension reloads itself, no store involved.`);
    if (open) {
      (this.opts.copy ?? ((t: string) => { spawnSync('pbcopy', { input: t }); }))(setup.extensionDir);
      (this.opts.openApp ?? ((app: string, url: string) => { spawnSync('open', ['-a', app, url]); }))(b.app, b.extensionsUrl);
      // after the browser, so the Finder window sits in front of it, with the folder selected
      (this.opts.reveal ?? ((dir: string) => { spawnSync('open', ['-R', dir]); }))(setup.extensionDir);
    }
    return 0;
  }

  /** What `list --json` prints (see the shape at the top of this file). */
  listing(): { schema: 1; extensionId: string; extensionDir: string; extensionBuilt: boolean; default: string | null; browsers: { id: string; name: string; installed: boolean; registered: boolean; extensionsUrl: string; hostManifest: string; link: BrowserLink; lastConnected: string | null; extensionVersion: string | null }[] } {
    const { setup } = this;
    const presence = new Presence(this.paths.user);
    return {
      schema: 1,
      extensionId: EXTENSION_ID,
      extensionDir: setup.extensionDir,
      extensionBuilt: setup.installed(),
      default: setup.defaultBrowser()?.id ?? null,
      // link: connected now / idle (the extension is loaded; it connects while claude.ai is open) / never (not loaded)
      browsers: setup.browsers().map((b: BrowserState) => {
        const p = b.registered ? presence.read(b.id) : null;
        return {
          id: b.id, name: b.name, installed: b.installed, registered: b.registered, extensionsUrl: b.extensionsUrl, hostManifest: b.hostManifest,
          link: b.registered ? presence.link(b.id) : 'never' as BrowserLink, lastConnected: p?.lastConnected ?? null, extensionVersion: p?.extensionVersion ?? null,
        };
      }),
    };
  }

  list(json: boolean): number {
    const { out } = this;
    const l = this.listing();
    if (json) { out.say(JSON.stringify(l, null, 2)); return 0; }
    for (const b of l.browsers) {
      const mark = !b.registered ? (b.installed ? 'installed' : out.dim('not installed'))
        : b.link === 'connected' ? out.green('connected') : b.link === 'idle' ? out.green('extension loaded') + out.dim(' (connects while claude.ai is open)') : out.yellow('extension not loaded yet');
      out.say(`${b.id.padEnd(9)} ${b.name.padEnd(15)} ${mark}${b.id === l.default ? out.dim('  (default)') : ''}`);
    }
    if (!l.extensionBuilt) out.say(out.dim('\nSet one up: cinnamon browser install [--browser <id>]'));
    return 0;
  }

  uninstall(which: string | 'all'): number {
    const { out, setup } = this;
    if (which !== 'all' && !setup.browsers().some((b) => b.id === which)) return out.fail(`unknown browser "${which}"`);
    const removed = setup.uninstall(which === 'all' ? 'all' : [which]);
    const presence = new Presence(this.paths.user);
    for (const b of BROWSERS) if (which === 'all' || which === b.id) presence.forget(b.id);
    out.say(removed.length ? `Removed:\n  ${removed.join('\n  ')}` : 'Nothing to remove.');
    if (removed.length) out.say('Remove "Cinnamon for Claude" from the browser\'s extensions page too.');
    return 0;
  }

  /** One line for `cinnamon status`. */
  statusLine(): string {
    const { out, setup } = this;
    if (!setup.installed()) return out.dim('not set up (cinnamon browser install)');
    const presence = new Presence(this.paths.user);
    const where = setup.browsers().filter((b) => b.registered).map((b) => {
      const link = presence.link(b.id);
      return `${b.name} (${link === 'connected' ? out.green('connected') : link === 'idle' ? 'loaded' : out.yellow('not loaded')})`;
    }).join(', ') || out.yellow('no browser');
    const s = BrowserHost.readStatus(this.paths.user);
    if (!s.connected) return `${where}: ${out.yellow('never connected; load the folder as an unpacked extension (cinnamon browser install)')}`;
    const extra = s.problem ? out.yellow(` · ${s.problem}`) : '';
    return `${where}: extension ${s.extensionVersion ?? '?'}, last connected ${new Date(s.connected).toLocaleString()}${extra}`;
  }

  status(): number { this.out.say(`browser  ${this.statusLine()}`); return 0; }

  /** The browser that started this process: the first ancestor that is one of the supported browsers' apps. */
  static parentBrowser(): string | null {
    let pid = process.ppid;
    for (let i = 0; i < 4 && pid > 1; i++) {
      const r = spawnSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' });
      const m = /^\s*(\d+)\s+(.*)$/.exec((r.stdout || '').trim());
      if (!m) return null;
      const id = Presence.browserOf(m[2]!, BROWSERS);
      if (id) return id;
      pid = Number(m[1]);
    }
    return null;
  }

  /** The browser's side of the connection: speaks native messaging on stdin/stdout until the browser closes it. */
  async host(): Promise<number> {
    const host = new BrowserHost({
      root: this.paths.root, userDir: this.paths.user, version: this.paths.version, extensionDir: this.setup.extensionDir,
      compiler: defaultCompiler(), write: (bytes) => { process.stdout.write(bytes); }, browserId: BrowserCommands.parentBrowser(),
    });
    await host.serve(Bun.stdin.stream() as unknown as AsyncIterable<Uint8Array>);
    return 0;
  }
}
