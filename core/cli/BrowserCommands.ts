// cinnamon browser install | uninstall | status, and `cinnamon browser-host` (what Chrome starts for the extension).
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { BrowserHost } from '../browser/BrowserHost';
import { BrowserSetup } from '../browser/BrowserSetup';
import { EXTENSION_ID } from '../browser/protocol';
import { defaultCompiler } from '../render';
import { sh } from './HelperClient';
import type { Output } from './Output';
import type { Paths } from './Paths';

export class BrowserCommands {
  readonly setup: BrowserSetup;

  constructor(private readonly paths: Paths, private readonly out: Output, home = os.homedir()) {
    this.setup = new BrowserSetup({ root: paths.root, userDir: paths.user, home, version: paths.version, binary: paths.binary, log: (l) => out.say(l) });
  }

  async install({ open = true } = {}): Promise<number> {
    const { out, setup } = this;
    const was = setup.installed();
    let r: { version: string; browsers: string[] };
    try { r = await setup.install(); } catch (e) { return out.fail(String((e as Error).message || e)); }
    out.say(`${out.green('✓')} Cinnamon extension ${r.version} built in ${setup.extensionDir}`);
    out.say(`${out.green('✓')} ${r.browsers.join(', ')} can start Cinnamon for it`);
    const status = BrowserHost.readStatus(this.paths.user);
    if (was && status.connected) {
      out.say('Updated in place: the extension reloads itself into this version the next time it connects.');
      return 0;
    }
    out.say(`
${out.bold('One-time setup in Chrome')} (chrome://extensions${open ? ', opening now' : ''}):
  1. Turn on ${out.bold('Developer mode')} (top right).
  2. Click ${out.bold('Load unpacked')} and pick this folder (press ⌘⇧G in the picker and paste it):
       ${setup.extensionDir}
  3. Click ${out.bold('Details')} on Cinnamon for Claude and turn on ${out.bold('Allow User Scripts')}, so extensions
     run on claude.ai (themes work without it).
Then open claude.ai: Settings → Appearance has Cinnamon's rows, as in the desktop app. Themes, extensions and settings
are shared with the desktop app. ${out.dim(`(extension id ${EXTENSION_ID})`)}
Updates come with ${out.bold('cinnamon update')}; the extension reloads itself, no store involved.`);
    if (open) {
      spawnSync('pbcopy', { input: setup.extensionDir });
      sh('open', ['-a', 'Google Chrome', 'chrome://extensions']);
      out.say(out.dim('(the folder path is on the clipboard)'));
    }
    return 0;
  }

  uninstall(): number {
    const removed = this.setup.uninstall();
    this.out.say(removed.length ? `Removed:\n  ${removed.join('\n  ')}` : 'The browser part was not set up.');
    if (removed.length) this.out.say('Remove "Cinnamon for Claude" in chrome://extensions too.');
    return 0;
  }

  /** One line for `cinnamon status`. */
  statusLine(): string {
    const { out, setup } = this;
    if (!setup.installed()) return out.dim('not set up (cinnamon browser install)');
    const s = BrowserHost.readStatus(this.paths.user);
    if (!s.connected) return out.yellow('built, never connected: load it in chrome://extensions (cinnamon browser install)');
    const when = new Date(s.connected).toLocaleString();
    const extra = s.problem ? out.yellow(` · ${s.problem}`) : s.userScripts === false ? out.yellow(' · user scripts off (themes only)') : '';
    return `extension ${s.extensionVersion ?? '?'}, last connected ${when}${extra}`;
  }

  status(): number { this.out.say(`browser  ${this.statusLine()}`); return 0; }

  /** Chrome's side of the connection: speaks native messaging on stdin/stdout until Chrome closes it. */
  async host(): Promise<number> {
    const host = new BrowserHost({
      root: this.paths.root, userDir: this.paths.user, version: this.paths.version, extensionDir: this.setup.extensionDir,
      compiler: defaultCompiler(), write: (bytes) => { process.stdout.write(bytes); },
    });
    await host.serve(Bun.stdin.stream() as unknown as AsyncIterable<Uint8Array>);
    return 0;
  }
}
