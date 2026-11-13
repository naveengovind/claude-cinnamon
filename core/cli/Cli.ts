// cinnamon — command-line tool for Cinnamon (themes and extensions for the Claude desktop app, macOS).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromEnv } from '../apply/main';
import { Installer } from '../install/Installer';
import { Config } from '../lib/Config';
import { ExtensionCatalog } from '../lib/ExtensionCatalog';
import { Doctor } from './Doctor';
import { ExtensionCommands } from './ExtensionCommands';
import { HelperClient, sh } from './HelperClient';
import { Output } from './Output';
import { Paths } from './Paths';
import { ThemeCommands } from './ThemeCommands';
import { Updater } from './Updater';

export class Cli {
  private readonly out = new Output();
  private readonly helper: HelperClient;
  private readonly themes: ThemeCommands;
  private readonly exts: ExtensionCommands;

  constructor(private readonly paths = new Paths()) {
    this.helper = new HelperClient(paths, this.out);
    this.themes = new ThemeCommands(paths, this.out);
    this.exts = new ExtensionCommands(paths, this.out);
  }

  get help(): string {
    return `${this.out.bold('cinnamon')} — themes and extensions for the Claude desktop app (macOS)

usage:
  cinnamon install [--rebuild]     build the helper and add the login item (re-applies at every Claude launch)
  cinnamon uninstall               remove the login item
  cinnamon apply [--keep]          apply now (--keep leaves Claude's debugger on)
  cinnamon status                  what is installed and applied
  cinnamon doctor                  check the setup and explain any problem
  cinnamon logs                    the helper's recent log
  cinnamon update                  upgrade Cinnamon and refresh the setup
  cinnamon version                 Cinnamon's version

  cinnamon theme [list]            themes (* = current)
  cinnamon theme <id>              use a theme ("default" = Claude's own colours)
  cinnamon theme install <source>  add themes from GitHub / git / a folder
  cinnamon theme remove <id>       remove an installed theme

  cinnamon ext [list]              extensions and whether they are on
  cinnamon ext enable|disable <id>
  cinnamon ext install <source>    add an extension from GitHub / git / a folder
  cinnamon ext remove <id>         remove an installed extension

  <source>: owner/repo, https://github.com/owner/repo[/tree/<branch>/<folder>], any git URL or local folder,
            optionally followed by #<folder>. Add --yes to skip the confirmation.

Your settings, themes and extensions: ${this.paths.user}`;
  }

  async main(argv: string[]): Promise<number> {
    const yes = argv.includes('--yes') || argv.includes('-y');
    const args = argv.filter((a) => a !== '--yes' && a !== '-y');
    const [cmd, sub, arg] = args;
    const { out } = this;
    switch (cmd) {
      case 'apply': return this.apply(args.includes('--keep') ? ['--keep'] : []);
      case 'install': return this.install();
      case 'uninstall': return this.installer().uninstall();
      case 'status': return this.status();
      case 'doctor': return new Doctor(this.paths, out, this.helper).run();
      case 'logs': return this.logs();
      case 'update': return this.update();
      case 'version':
      case '--version':
      case '-v':
        out.say(this.paths.version);
        return 0;
      case 'theme':
      case 'themes':
        if (!sub || sub === 'list') return this.themes.list();
        if (sub === 'install') return arg ? this.themes.install(arg, yes) : out.fail('usage: cinnamon theme install <source>');
        if (sub === 'remove') return arg ? this.themes.remove(arg) : out.fail('usage: cinnamon theme remove <id>');
        return this.themes.set(sub);
      case 'ext':
      case 'extension':
      case 'extensions':
        if (!sub || sub === 'list') return this.exts.list();
        if (sub === 'enable' || sub === 'disable') return arg ? this.exts.setEnabled(arg, sub === 'enable') : out.fail(`usage: cinnamon ext ${sub} <id>`);
        if (sub === 'install') return arg ? this.exts.install(arg, yes) : out.fail('usage: cinnamon ext install <source>');
        if (sub === 'remove') return arg ? this.exts.remove(arg) : out.fail('usage: cinnamon ext remove <id>');
        return out.fail(`unknown: cinnamon ext ${sub}\n\n${this.help}`);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        out.say(this.help);
        return cmd === undefined ? 1 : 0;
      default:
        console.error(`unknown command: ${cmd}\n\n${this.help}`);
        return 1;
    }
  }

  /** Through the helper (it holds the Accessibility permission); directly with --keep or without the login item. */
  private async apply(extra: string[]): Promise<number> {
    if (process.env.CINNAMON_NO_APPLY) return 0;
    if (!HelperClient.claudePid()) { this.out.say(this.out.dim('Claude is not running; Cinnamon applies itself the next time it starts.')); return 0; }
    if (extra.includes('--keep') || !this.helper.loaded()) return fromEnv({ ...process.env, CINNAMON_ROOT: this.paths.root, CINNAMON_HOME: this.paths.user }).applier.run({ keep: extra.includes('--keep') });
    return this.helper.applyAgain();
  }

  private install(): number {
    const { paths } = this;
    for (const d of [paths.user, paths.themes, paths.extensions]) fs.mkdirSync(d, { recursive: true });
    fs.rmSync(paths.applied, { force: true }); // the helper applies to a running Claude as soon as it starts
    const start = this.helper.logSize();
    const code = this.installer().install({ rebuild: process.argv.includes('--rebuild') });
    if (code !== 0) return code;
    if (process.env.CINNAMON_NO_APPLY || !HelperClient.claudePid()) return 0;
    return this.helper.follow(start, { notAllowedOk: true });
  }

  private installer(): Installer {
    const { paths } = this;
    return new Installer({
      root: paths.root, userDir: paths.user, home: os.homedir(), pathEnv: process.env.PATH || '', bun: process.execPath, uid: process.getuid!(),
      ...(paths.binary ? { binary: paths.binary, prebuiltHelper: path.join(paths.root, 'prebuilt', 'Cinnamon Helper.app') } : {}),
    });
  }

  private status(): number {
    const { out, paths } = this;
    const pid = HelperClient.claudePid();
    const cfg = new Config(paths.config).read();
    let applied = 'no';
    try {
      const [apid] = fs.readFileSync(paths.applied, 'utf8').trim().split(' ');
      applied = pid && apid === pid ? out.green('yes') : out.yellow('not to this Claude process');
    } catch {}
    const on = this.exts.all().filter((e) => ExtensionCatalog.isEnabled(e, cfg)).map((e) => e.id);
    out.say(`${out.bold('Cinnamon')} ${out.dim(paths.root)}`);
    out.say(`  your files   ${paths.user}`);
    out.say(`  login item   ${this.helper.loaded() ? out.green('running') : out.yellow('not installed (cinnamon install)')}`);
    out.say(`  Claude       ${pid ? `running (pid ${pid})` : out.dim('not running')}`);
    out.say(`  applied      ${pid ? applied : out.dim('-')}`);
    out.say(`  theme        ${cfg.theme}`);
    out.say(`  extensions   ${on.join(', ') || out.dim('none')}`);
    return 0;
  }

  private logs(): number {
    try { this.out.say(fs.readFileSync(this.paths.logs, 'utf8').trimEnd().split('\n').slice(-60).join('\n')); return 0; }
    catch { return this.out.fail(`no log yet (${this.paths.logs})`); }
  }

  /** Homebrew installs: brew upgrade. The standalone binary otherwise: the latest release. A development checkout:
   *  git pull. Then the new version's install refreshes the login item and re-applies. */
  private update(): number {
    const { out, paths } = this;
    if (paths.binary && !paths.homebrew) {
      return new Updater({ binary: paths.binary, version: paths.version, arch: process.arch === 'arm64' ? 'arm64' : 'x64', repo: Paths.REPO, log: (l) => out.say(l) }).run();
    }
    if (!paths.binary && fs.existsSync(path.join(paths.root, '.git'))) {
      if (sh('git', ['-C', paths.root, 'pull', '--ff-only'], { stdio: 'inherit' }).status !== 0) return out.fail('git pull failed');
      return this.install();
    }
    const brew = paths.homebrew ? path.join(paths.homebrew, 'bin', 'brew') : 'brew';
    if (!paths.homebrew && sh('which', ['brew']).status !== 0) return out.fail(`Homebrew not found; Cinnamon installs with: brew install ${Paths.FORMULA}`);
    if (sh(brew, ['upgrade', Paths.FORMULA], { stdio: 'inherit' }).status !== 0) return out.fail('brew upgrade failed');
    if (process.env.CINNAMON_NO_APPLY) return 0;
    // the new version's own installer (the binary's opt/ path now leads to it): keeps the helper if its source is unchanged
    return sh(paths.binary ?? path.join(paths.root, 'bin', 'cinnamon'), ['install'], { stdio: 'inherit' }).status ?? 1;
  }
}
