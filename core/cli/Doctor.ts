// cinnamon doctor: checks the setup and says how to fix what's wrong.
import fs from 'node:fs';
import { ExtensionCatalog } from '../lib/ExtensionCatalog';
import { ThemeStore } from '../lib/ThemeStore';
import { HelperClient, sh } from './HelperClient';
import type { Output } from './Output';
import type { Paths } from './Paths';

export class Doctor {
  private problems = 0;

  constructor(private readonly paths: Paths, private readonly out: Output, private readonly helper: HelperClient) {}

  private check(ok: boolean, text: string, fix?: string): void {
    const { out } = this;
    out.say(`${ok ? out.green('✓') : out.red('✗')} ${text}${!ok && fix ? out.dim(`  → ${fix}`) : ''}`);
    if (!ok) this.problems++;
  }

  run(): number {
    const { out, paths } = this;
    this.problems = 0;
    this.check(!!process.versions.bun, `Bun ${process.versions.bun || '(not running under Bun)'}`, 'brew install oven-sh/bun/bun');
    this.check(fs.existsSync('/Applications/Claude.app'), 'Claude.app is in /Applications');
    const ver = sh('defaults', ['read', '/Applications/Claude.app/Contents/Info.plist', 'CFBundleShortVersionString']).stdout?.trim();
    if (ver) out.say(out.dim(`  Claude ${ver}`));
    this.check(sh('which', ['swiftc']).status === 0, 'Swift compiler (to build the helper)', 'xcode-select --install');
    this.check(this.helper.loaded(), 'login item running', 'cinnamon install');
    this.check(fs.existsSync(paths.helperApp), 'helper app built', 'cinnamon install');
    let log = '';
    try { log = fs.readFileSync(paths.logs, 'utf8'); } catch {}
    const lastStart = log.lastIndexOf('watching ');
    const recent = lastStart === -1 ? '' : log.slice(lastStart);
    const allowed = !/NOT allowed/.test(recent.split('\n')[0] || '') || /Accessibility allowed/.test(recent);
    this.check(allowed, 'helper may use Accessibility', 'System Settings → Privacy & Security → Accessibility → turn on Cinnamon Helper');
    this.check(!/never appeared/.test(recent), 'Developer menu found at the last launch', 'in Claude: Help → Troubleshooting → Enable Developer Mode');
    const finished = [...recent.matchAll(/apply finished with status (\d+)/g)].pop();
    if (finished) this.check(finished[1] === '0', `last automatic apply ${finished[1] === '0' ? 'succeeded' : 'failed'}`, 'cinnamon logs');
    for (const t of new ThemeStore([paths.bundledThemes, paths.themes]).list()) if (t.error) this.check(false, `theme ${t.id}: ${t.error}`);
    for (const e of new ExtensionCatalog({ bundled: paths.bundledExtensions, user: paths.extensions }).list()) if (e.error) this.check(false, `extension ${e.id}: ${e.error}`);
    out.say(this.problems ? out.red(`${this.problems} problem${this.problems > 1 ? 's' : ''}`) : out.green('All good.'));
    return this.problems ? 1 : 0;
  }
}
