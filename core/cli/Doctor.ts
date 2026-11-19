// cinnamon doctor: checks the setup and says how to fix what's wrong.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserHost } from '../browser/BrowserHost';
import { BrowserSetup } from '../browser/BrowserSetup';
import { Backdrop } from '../lib/Backdrop';
import { Config } from '../lib/Config';
import { permissionPrefs } from '../lib/Permissions';
import { ExtensionCatalog } from '../lib/ExtensionCatalog';
import { ThemeEngine } from '../lib/ThemeEngine';
import { ThemeStore } from '../lib/ThemeStore';
import { HelperClient, sh } from './HelperClient';
import { Installer } from '../install/Installer';
import type { Output } from './Output';
import type { Paths } from './Paths';

/** One check, as `doctor --json` gives it: `id` names what is checked (theme:<id> and ext:<id> for those). */
export interface Check { id: string; ok: boolean; text: string; fix?: string }

export class Doctor {
  private problems = 0;
  private checks: Check[] = [];
  private notes: string[] = [];
  private json = false;

  constructor(private readonly paths: Paths, private readonly out: Output, private readonly helper: HelperClient) {}

  private check(id: string, ok: boolean, text: string, fix?: string): void {
    const { out } = this;
    this.checks.push({ id, ok, text, ...(!ok && fix ? { fix } : {}) });
    if (!this.json) out.say(`${ok ? out.green('✓') : out.red('✗')} ${text}${!ok && fix ? out.dim(`  → ${fix}`) : ''}`);
    if (!ok) this.problems++;
  }

  private note(text: string): void {
    this.notes.push(text);
    if (!this.json) this.out.say(this.out.dim(`  ${text}`));
  }

  run({ json = false } = {}): number {
    const { out, paths } = this;
    this.problems = 0;
    this.checks = [];
    this.notes = [];
    this.json = json;
    this.note(`Cinnamon ${paths.version}${paths.binary ? ` (standalone: ${paths.binary})` : ''}`);
    this.check('bun', !!process.versions.bun, `Bun ${process.versions.bun || '(not running under Bun)'}${paths.binary ? ' (built in)' : ''}`, 'brew install oven-sh/bun/bun');
    this.check('claude', fs.existsSync('/Applications/Claude.app'), 'Claude.app is in /Applications', 'download Claude from claude.ai/download');
    const ver = sh('defaults', ['read', '/Applications/Claude.app/Contents/Info.plist', 'CFBundleShortVersionString']).stdout?.trim();
    if (ver) this.note(`Claude ${ver}`);
    if (!paths.binary) this.check('swiftc', sh('which', ['swiftc']).status === 0, 'Swift compiler (to build the helper)', 'xcode-select --install'); // the standalone helper comes prebuilt
    this.check('helper', this.helper.loaded(), 'login item running', 'cinnamon install');
    this.check('helper-app', fs.existsSync(paths.helperApp), 'helper app built', 'cinnamon install');
    let log = '';
    try { log = fs.readFileSync(paths.logs, 'utf8'); } catch {}
    const lastStart = log.lastIndexOf('watching ');
    const recent = lastStart === -1 ? '' : log.slice(lastStart);
    const prefs = permissionPrefs(new Config(paths.config).read());
    if (prefs.mode === 'accessibility') {
      const allowed = !/NOT allowed/.test(recent.split('\n')[0] || '') || /Accessibility allowed/.test(recent);
      this.check('accessibility', allowed, 'helper may use Accessibility', 'System Settings → Privacy & Security → Accessibility → turn on Cinnamon Helper');
      this.check('developer-mode', !/never appeared/.test(recent), 'Developer menu found at the last launch', 'in Claude: Help → Troubleshooting → Enable Developer Mode');
    } else {
      this.note('permissions: none. Each time Claude starts, choose Developer → Enable Main Process Debugger in Claude (Developer Mode must be on)');
    }
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${Installer.LABEL}.plist`);
    let plistText = '';
    try { plistText = fs.readFileSync(plist, 'utf8'); } catch {}
    if (plistText) this.check('permissions-mode', plistText.includes('--no-accessibility') === (prefs.mode === 'none'), `login item set up for permissions: ${prefs.mode}`, 'cinnamon install');
    this.note(prefs.closeChromeTab ? 'Chrome: closes the chrome://inspect tab (Automation → Google Chrome)' : 'Chrome: left alone (cinnamon permissions chrome-tab on closes the chrome://inspect tab)');
    const finished = [...recent.matchAll(/apply finished with status (\d+)/g)].pop();
    if (finished) this.check('last-apply', finished[1] === '0', `last automatic apply ${finished[1] === '0' ? 'succeeded' : 'failed'}`, 'cinnamon logs');
    // the Code tab's colors: Claude Code's own theme API through the cinnamon-colors mod, else Cinnamon paints them
    const mod = path.join(os.homedir(), '.claude', 'skills', 'cinnamon-colors', '.claude-plugin', 'plugin.json');
    this.check('mod', fs.existsSync(mod), 'cinnamon-colors mod installed (Claude Code paints the Code tab)', 'cinnamon install');
    this.check('skill', fs.existsSync(path.join(os.homedir(), '.claude', 'skills', 'cinnamon', 'SKILL.md')), 'cinnamon skill installed (Claude Code can theme and extend the app)', 'cinnamon install');
    try {
      const r = new ThemeStore([paths.bundledThemes, paths.themes]).resolve(new Config(paths.config));
      if (r.current !== 'default') {
        this.note(r.look
          ? `Code tab: ${r.current} through Claude Code's theme API${r.look.dropped.length ? ` (the app picks: ${r.look.dropped.join(', ')})` : ''}`
          : `Code tab: ${r.current} painted by Cinnamon (${r.lookReason || 'no look'})`);
      }
    } catch {}
    for (const t of new ThemeStore([paths.bundledThemes, paths.themes]).list()) {
      if (t.error) this.check(`theme:${t.id}`, false, `theme ${t.id}: ${t.error}`);
      else for (const p of [...ThemeEngine.problems(t.theme), ...Backdrop.resolve(t.theme, path.dirname(t.file), t.id).errors]) this.check(`theme:${t.id}`, false, `theme ${t.id}: ${p}`, `edit ${t.file}`);
    }
    const recorded = ExtensionCatalog.recordedErrors(paths.user);
    for (const e of new ExtensionCatalog({ bundled: paths.bundledExtensions, user: paths.extensions }).list()) {
      if (e.error) this.check(`ext:${e.id}`, false, `extension ${e.id}: ${e.error}`);
      else for (const err of recorded[e.id] || []) this.check(`ext:${e.id}`, false, `extension ${e.id}: ${err.split('\n')[0]}`, `fix ${e.dir}`);
    }
    this.browser();
    if (json) out.json({ ok: this.problems === 0, problems: this.problems, checks: this.checks, notes: this.notes });
    else out.say(this.problems ? out.red(`${this.problems} problem${this.problems > 1 ? 's' : ''}`) : out.green('All good.'));
    return this.problems ? 1 : 0;
  }

  /** The browser part (claude.ai in Chrome), only when it is set up. */
  private browser(): void {
    const { paths } = this;
    const setup = new BrowserSetup({ root: paths.root, userDir: paths.user, home: os.homedir(), version: paths.version, binary: paths.binary });
    if (!setup.installed()) { this.note('browser: not set up (optional: cinnamon browser install)'); return; }
    const registered = setup.browsers().filter((b) => b.registered);
    this.check('browser-host', registered.length > 0, 'a browser can start Cinnamon for the extension', 'cinnamon browser install --browser <id>');
    for (const b of registered) {
      let pointsHere = false;
      try { pointsHere = (JSON.parse(fs.readFileSync(b.hostManifest, 'utf8')) as { path?: string }).path === setup.hostScript && fs.existsSync(setup.hostScript); } catch {}
      this.check(`browser-host:${b.id}`, pointsHere, `${b.name} can start Cinnamon for the extension`, `cinnamon browser install --browser ${b.id}`);
    }
    const s = BrowserHost.readStatus(paths.user);
    this.check('browser-connected', !!s.connected, s.connected ? `browser extension connected (last ${new Date(s.connected).toLocaleString()})` : 'browser extension has connected',
      `the browser's extensions page → Developer mode → drag in ${setup.extensionDir}`);
    if (s.connected && s.folderVersion && s.extensionVersion && s.folderVersion !== s.extensionVersion) {
      this.note(`browser extension ${s.extensionVersion} reloads into ${s.folderVersion} when it next connects`);
    }
    if (s.problem) this.check('browser-page-code', false, `browser: ${s.problem}`);
    for (const [id, errs] of Object.entries(s.errors || {})) for (const e of errs) this.check(`browser-ext:${id}`, false, `extension ${id} in the browser: ${e.split('\n')[0]}`);
  }
}
