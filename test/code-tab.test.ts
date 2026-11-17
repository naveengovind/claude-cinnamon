import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodeTabLook } from '../core/lib/CodeTabLook';
import { ThemeEngine } from '../core/lib/ThemeEngine';
import { ThemeStore } from '../core/lib/ThemeStore';
import { Config } from '../core/lib/Config';

const ROOT = path.join(import.meta.dir, '..');
const codex = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'codex.json'), 'utf8'));
const glass = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'glass.json'), 'utf8'));
const darkInputs = (look: { colors: unknown }) => (look.colors as { inputs: { dark: Record<string, string> } }).inputs.dark;

test('Codex becomes a look the Desktop paints, keeping its near-black surfaces', () => {
  const { look } = CodeTabLook.fromTheme('codex', codex);
  assert.ok(look, 'Codex has a Code-tab look');
  assert.match(look!.id, /^codex:[0-9a-f]{8}$/);
  // Codex's own muted text is under the Desktop's contrast bar, so it is left to the design system
  assert.ok(look!.dropped.includes('text-muted'));
  assert.equal(darkInputs(look!)['gray-900'], '#111111');
});

test('the same theme gives the same id; a color change gives another', () => {
  const a = CodeTabLook.fromTheme('codex', codex).look!;
  const b = CodeTabLook.fromTheme('codex', codex).look!;
  const c = CodeTabLook.fromTheme('codex', { ...codex, dark: { ...codex.dark, background: '#141414' } }).look!;
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test('a theme with a window material (Glass) has no look: Cinnamon paints it everywhere', () => {
  const r = CodeTabLook.fromTheme('glass', glass);
  assert.equal(r.look, null);
  assert.match(r.reason!, /window material/);
});

test('"codeTab": false opts a theme out', () => {
  assert.equal(CodeTabLook.fromTheme('x', { ...codex, codeTab: false }).look, null);
});

test('"codeTab" as an object is passed to makeColors as it is', () => {
  const { look } = CodeTabLook.fromTheme('paper', {
    name: 'Paper',
    dark: { background: '#000000' },
    // Claude Code's own example look (plugin-authoring/examples/look.ts), dark half
    codeTab: { dark: { gray: { anchors: { 'surface-0': '#1f1a15', 'surface-1': '#28221b', 'surface-2': '#312a22', 'surface-3': '#3a3229',
      'text-primary': '#f0e7d7', 'text-secondary': '#cfc4b2', 'text-muted': '#aca08d' } } } },
  });
  assert.ok(look);
  assert.equal(darkInputs(look!)['gray-900'], '#1f1a15');
});

test('colors that are not six- or three-digit hex are skipped, and a mode without background and text is left out', () => {
  const r = CodeTabLook.fromTheme('t', { dark: { background: 'rgb(1,2,3)', text: '#fff' } });
  assert.equal(r.look, null);
  assert.match(r.reason!, /background and text/);
  const ok = CodeTabLook.fromTheme('t', { dark: { background: '#121', text: '#fafafa', raised: 'transparent' } }).look;
  assert.ok(ok);
  assert.equal(darkInputs(ok!)['gray-900'], '#112211');
});

const GUARD = ':not([data-cinnamon-code-tab="mod"], [data-cinnamon-code-tab="mod"] *)';
/** selector → declarations, for every rule outside @media */
const rules = (css: string) => [...css.replace(/@media[^{]*\{[\s\S]*?\n\}\n/g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sels: m[1]!.trim().split(',\n').map((x) => x.trim()), body: m[2]! }));

test('the colors a look carries step aside where the app paints it; the rest stay Cinnamon\'s', () => {
  const { css } = ThemeEngine.css(codex, { yieldKeys: CodeTabLook.KEYS });
  const rs = rules(css);
  const guarded = rs.filter((r) => r.sels.every((x) => x.endsWith(GUARD)));
  const open = rs.filter((r) => r.sels.every((x) => !x.endsWith(GUARD)));
  assert.strictEqual(guarded.length + open.length, rs.length, 'a rule is either guarded or not, never mixed');
  const g = guarded.map((r) => r.body).join('');
  const o = open.map((r) => r.body).join('');
  // background, raised, panel, text…, accent: the look's
  for (const v of ['--cds-surface-1', '--cds-surface-2', '--cds-surface-3', '--cds-fizzy-lake-color-solid-primary', '--cds-text-secondary', '--cds-role-accent-450']) {
    assert.match(g, new RegExp(v));
    assert.doesNotMatch(o, new RegExp(`${v}:`));
  }
  // sidebar, popover, borders, hover, code panels: Cinnamon's, also in the Code tab
  for (const v of ['--cds-fizzy-lake-color-sidebar', '--cds-surface-popover', '--cds-border-line', '--cds-fill-ghost-hover', '--code-theme-dark-bg']) {
    assert.match(o, new RegExp(v));
    assert.doesNotMatch(g, new RegExp(`${v}:`));
  }
  assert.match(o, /background-color: #151515/, 'the sidebar itself');
});

test('raw vars stay Cinnamon\'s everywhere', () => {
  const { css } = ThemeEngine.css({ dark: { background: '#111111', vars: { '--cds-x': '#123456' } } }, { yieldKeys: CodeTabLook.KEYS });
  const open = rules(css).filter((r) => r.sels.every((x) => !x.endsWith(GUARD))).map((r) => r.body).join('');
  assert.match(open, /--cds-x: #123456/);
});

test('extra css is not guarded: mods cannot do it, so it applies everywhere', () => {
  const { css } = ThemeEngine.css({ ...codex, css: '.x { color: red; }' }, { yieldKeys: CodeTabLook.KEYS });
  assert.match(css, /\n\.x \{ color: red; \}/);
});

test('without a look nothing is scoped', () => {
  assert.doesNotMatch(ThemeEngine.css(glass).css, /cinnamon-code-tab/);
  assert.doesNotMatch(ThemeEngine.css(codex).css, /cinnamon-code-tab/);
});

test('the store resolves the picked theme with its look, and Glass without one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-codetab-'));
  const cfg = path.join(dir, 'config.json');
  const store = new ThemeStore([path.join(ROOT, 'themes')]);
  fs.writeFileSync(cfg, JSON.stringify({ theme: 'codex' }));
  const r = store.resolve(new Config(cfg));
  assert.ok(r.look);
  assert.match(r.css, /cinnamon-code-tab/);
  fs.writeFileSync(cfg, JSON.stringify({ theme: 'glass' }));
  const g = store.resolve(new Config(cfg));
  assert.equal(g.look, null);
  assert.doesNotMatch(g.css, /cinnamon-code-tab/);
  fs.writeFileSync(cfg, JSON.stringify({ theme: 'default' }));
  assert.equal(store.resolve(new Config(cfg)).look, null);
});

test('the look file holds { id, colors } for the mod, or { id: null }', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-codetab-'));
  const file = path.join(dir, 'state', 'code-tab-look.json');
  const look = CodeTabLook.fromTheme('codex', codex).look;
  assert.equal(CodeTabLook.write(file, look), true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.id, look!.id);
  assert.ok(saved.colors);
  assert.equal(CodeTabLook.write(file, look), false, 'unchanged: not rewritten');
  CodeTabLook.write(file, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { id: null });
});

test('the look\'s print names app variables and values the page can compare', () => {
  const look = CodeTabLook.fromTheme('codex', codex).look;
  const print = CodeTabLook.print(look)!;
  assert.strictEqual(print.dark!['--cds-gray-900'], '#111111');
  assert.ok(print.dark!['--cds-role-accent-600']);
  // none of them is a variable Cinnamon's own theme CSS sets (the page would read Cinnamon's value, not the app's)
  const ours = new Set(Object.values(ThemeEngine.TOKENS).flat());
  for (const name of Object.keys(print.dark!)) assert.ok(!ours.has(name), name);
  assert.strictEqual(CodeTabLook.print(null), null);
});

