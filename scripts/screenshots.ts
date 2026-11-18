// Takes the screenshots for the README and the website (site/shots/) from the running Claude app, with nothing of
// yours in them: bun scripts/screenshots.ts [shot ...]
//
// It puts tools/demo-mask in place as a user extension (it swaps chat, session, folder, branch and account names for
// made-up ones), steers the page through the mask's `go` / `click` settings, switches themes and extensions with the
// CLI, and takes each picture with `cinnamon screenshot`. Your config.json is backed up first and put back at the end,
// and the mask is removed. Nothing needs the debugger, so no Chrome tab opens.
//
// LOOK AT EVERY PICTURE before you commit it: the mask replaces what it doesn't know, but a new kind of screen can
// still show something it doesn't cover (the main area of an open conversation is never masked; don't shoot one).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Paths } from '../core/cli/Paths';

const ROOT = path.join(import.meta.dir, '..');
const OUT = path.join(ROOT, 'site', 'shots');
const paths = new Paths(process.env);
const MASK_ID = 'demo-mask';
const maskDir = path.join(paths.extensions, MASK_ID);

interface Shot {
  name: string;
  theme: string;
  path: string;
  extensions?: Record<string, boolean>;
  clicks?: string[];
  /** Seconds to wait before the picture (an animation, a cow). */
  wait?: number;
}

const SHOTS: Shot[] = [
  { name: 'ember-code', theme: 'ember', path: '/epitaxy' },
  { name: 'codex-code', theme: 'codex', path: '/epitaxy' },
  // The Chat tab (ember-chat) and Settings → Appearance (ember-settings) are opened by hand and shot with
  // `cinnamon screenshot` while the mask is on (run this script with a shot that waits, or install the mask yourself).
  // Glass and Claude's own look aren't shot: Claude's own capture can't see the window material, and a screen capture would show your desktop.
  // (Claude's own look uses that material for its sidebar too.)
  { name: 'ufo', theme: 'ember', path: '/epitaxy', extensions: { 'ufo-critter': true }, wait: 9 },
];

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

function cli(...args: string[]): string {
  const r = spawnSync('bun', [path.join(ROOT, 'core', 'cli', 'main.ts'), ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  if (r.status !== 0) throw new Error(`cinnamon ${args.join(' ')}: ${r.stdout}${r.stderr}`);
  return r.stdout;
}

/** Sets one of the mask's settings (config.json, read live by the page). */
function steer(key: string, value: unknown): void {
  const cfg = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
  ((cfg.settings ??= {})[MASK_ID] ??= {})[key] = value;
  const tmp = `${paths.config}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(tmp, paths.config);
}

function installMask(): void {
  fs.mkdirSync(maskDir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'tools', MASK_ID))) {
    let text = fs.readFileSync(path.join(ROOT, 'tools', MASK_ID, f), 'utf8');
    text = text.replace('../../types/cinnamon.d.ts', path.join(ROOT, 'types', 'cinnamon.d.ts'));
    fs.writeFileSync(path.join(maskDir, f), text);
  }
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const shots = only.length ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;
  fs.mkdirSync(OUT, { recursive: true });
  const backup = fs.existsSync(paths.config) ? fs.readFileSync(paths.config, 'utf8') : null;
  try {
    installMask();
    await sleep(5);
    for (const shot of shots) {
      cli('theme', shot.theme);
      const exts = { 'ufo-critter': false, 'tetris-busy': false, ...shot.extensions };
      for (const [id, on] of Object.entries(exts)) { try { cli('ext', on ? 'enable' : 'disable', id); } catch {} }
      steer('go', shot.path);
      await sleep(8);
      for (const label of shot.clicks || []) { steer('click', label); await sleep(2); }
      await sleep(shot.wait ?? 3);
      const file = path.join(OUT, `${shot.name}.png`);
      cli('screenshot', '--out', file, '--width', '1600');
      console.log(`${shot.name}: ${path.relative(ROOT, file)}`);
    }
  } finally {
    fs.rmSync(maskDir, { recursive: true, force: true });
    if (backup !== null) {
      const tmp = `${paths.config}.tmp`;
      fs.writeFileSync(tmp, backup);
      fs.renameSync(tmp, paths.config);
    }
    console.log('Put your config back and removed the mask. Look at every picture before you commit it.');
  }
}

await main();
