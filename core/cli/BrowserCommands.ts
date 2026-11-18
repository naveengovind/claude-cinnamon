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
import { BrowserSetup, type BrowserState } from '../browser/BrowserSetup';
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
  2. Click ${out.bold('Load unpacked')} and pick this folder (press ⌘⇧G in the picker and paste it):
       ${setup.extensionDir}
  3. Open ${out.bold('Details')} on Cinnamon for Claude and turn on ${out.bold('Allow User Scripts')} if it's there, so
     extensions run on claude.ai whatever the page allows (themes work without it).
Then open claude.ai: Settings → Appearance has Cinnamon's rows, as in the desktop app. Themes, extensions and settings
are shared with the desktop app. ${out.dim(`(extension id ${EXTENSION_ID})`)}
Updates come with ${out.bold('cinnamon update')}; the extension reloads itself, no store involved.`);
    if (open) {
      (this.opts.copy ?? ((t: string) => { spawnSync('pbcopy', { input: t }); }))(setup.extensionDir);
      (this.opts.openApp ?? ((app: string, url: string) => { spawnSync('open', ['-a', app, url]); }))(b.app, b.extensionsUrl);
      out.say(out.dim('(the folder path is on the clipboard)'));
    }
    return 0;
  }

  /** What `list --json` prints (see the shape at the top of this file). */
  listing(): { schema: 1; extensionId: string; extensionDir: string; extensionBuilt: boolean; default: string | null; browsers: { id: string; name: string; installed: boolean; registered: boolean; extensionsUrl: string; hostManifest: string }[] } {
    const { setup } = this;
    return {
      schema: 1,
      extensionId: EXTENSION_ID,
      extensionDir: setup.extensionDir,
      extensionBuilt: setup.installed(),
      default: setup.defaultBrowser()?.id ?? null,
      browsers: setup.browsers().map((b: BrowserState) => ({ id: b.id, name: b.name, installed: b.installed, registered: b.registered, extensionsUrl: b.extensionsUrl, hostManifest: b.hostManifest })),
    };
  }

  list(json: boolean): number {
    const { out } = this;
    const l = this.listing();
    if (json) { out.say(JSON.stringify(l, null, 2)); return 0; }
    for (const b of l.browsers) {
      const mark = b.registered ? out.green('set up') : b.installed ? 'installed' : out.dim('not installed');
      out.say(`${b.id.padEnd(9)} ${b.name.padEnd(15)} ${mark}${b.id === l.default ? out.dim('  (default)') : ''}`);
    }
    if (!l.extensionBuilt) out.say(out.dim('\nSet one up: cinnamon browser install [--browser <id>]'));
    return 0;
  }

  uninstall(which: string | 'all'): number {
    const { out, setup } = this;
    if (which !== 'all' && !setup.browsers().some((b) => b.id === which)) return out.fail(`unknown browser "${which}"`);
    const removed = setup.uninstall(which === 'all' ? 'all' : [which]);
    out.say(removed.length ? `Removed:\n  ${removed.join('\n  ')}` : 'Nothing to remove.');
    if (removed.length) out.say('Remove "Cinnamon for Claude" from the browser\'s extensions page too.');
    return 0;
  }

  /** One line for `cinnamon status`. */
  statusLine(): string {
    const { out, setup } = this;
    if (!setup.installed()) return out.dim('not set up (cinnamon browser install)');
    const where = setup.browsers().filter((b) => b.registered).map((b) => b.name).join(', ') || out.yellow('no browser');
    const s = BrowserHost.readStatus(this.paths.user);
    if (!s.connected) return `${where}: ${out.yellow('never connected; load the folder as an unpacked extension (cinnamon browser install)')}`;
    const extra = s.problem ? out.yellow(` · ${s.problem}`) : s.userScripts === false ? out.dim(' · user scripts off') : '';
    return `${where}: extension ${s.extensionVersion ?? '?'}, last connected ${new Date(s.connected).toLocaleString()}${extra}`;
  }

  status(): number { this.out.say(`browser  ${this.statusLine()}`); return 0; }

  /** The browser's side of the connection: speaks native messaging on stdin/stdout until the browser closes it. */
  async host(): Promise<number> {
    const host = new BrowserHost({
      root: this.paths.root, userDir: this.paths.user, version: this.paths.version, extensionDir: this.setup.extensionDir,
      compiler: defaultCompiler(), write: (bytes) => { process.stdout.write(bytes); },
    });
    await host.serve(Bun.stdin.stream() as unknown as AsyncIterable<Uint8Array>);
    return 0;
  }
}
