const { test, afterEach } = require('bun:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { themeCss, listThemes, readConfig, writeConfig, resolveTheme, TOKENS } = require('../core/theme.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-theme-'));
const write = (dir, name, obj) => fs.writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));

test('a colour key sets every app variable it stands for, in dark mode, with !important', () => {
  const { css } = themeCss({ dark: { background: '#111111' } });
  for (const v of TOKENS.background) assert.match(css, new RegExp(`${v}: #111111 !important`));
  assert.match(css, /:root\[data-mode="dark"\]/);
});

test('dark colours also apply when the app follows a dark system setting', () => {
  const { css } = themeCss({ dark: { background: '#111111' } });
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{[^@]*\[data-mode="system"\][^}]*--cds-surface-1: #111111/);
});

test('a theme without a light section leaves light mode alone', () => {
  const { css } = themeCss({ dark: { background: '#111111' } });
  assert.doesNotMatch(css, /data-mode="light"/);
  assert.doesNotMatch(css, /prefers-color-scheme: light/);
});

test('a light section is applied to light mode', () => {
  const { css } = themeCss({ light: { background: '#fafafa' } });
  assert.match(css, /:root\[data-mode="light"\][^}]*--cds-surface-1: #fafafa !important/);
  assert.doesNotMatch(css, /data-mode="dark"/);
});

test('sidebar colours go on the sidebar itself', () => {
  const { css } = themeCss({ dark: { sidebar: '#151515', 'text-sidebar': '#dcdcdc' } });
  assert.match(css, /\[data-mode="dark"\] \.dframe-sidebar\s*\{[^}]*background-color: #151515 !important/);
  assert.match(css, /\[data-mode="dark"\] \.dframe-sidebar\s*\{[^}]*--cds-text-primary: #dcdcdc !important/);
});

test('code-background recolours code panels and blocks, which take their colour from the code theme', () => {
  const dark = themeCss({ dark: { 'code-background': '#111111' } }).css;
  assert.match(dark, /\[data-mode="dark"\] \[style\*="--code-theme-dark-bg"\]\s*\{[^}]*--code-theme-dark-bg: #111111 !important;[^}]*--code-theme-bg: #111111 !important/);
  const light = themeCss({ light: { 'code-background': '#fafafa' } }).css;
  assert.match(light, /\[data-mode="light"\] \[style\*="--code-theme-light-bg"\]\s*\{[^}]*--code-theme-light-bg: #fafafa !important/);
});

test('vars sets any variable directly', () => {
  const { css } = themeCss({ dark: { vars: { '--cds-switch-track': '#333333' } } });
  assert.match(css, /--cds-switch-track: #333333 !important/);
});

test('values that could break the stylesheet are rejected and reported', () => {
  const { css, errors } = themeCss({ dark: { background: 'red; } body { display:none', text: '#fff', vars: { 'not-a-var': '#000', '--ok': 'x{' } } });
  assert.doesNotMatch(css, /display:none/);
  assert.doesNotMatch(css, /not-a-var/);
  assert.doesNotMatch(css, /--ok/);
  assert.match(css, /--cds-text-primary: #fff/);
  assert.strictEqual(errors.length, 3, errors.join('\n'));
});

test('unknown colour keys are reported, not emitted', () => {
  const { css, errors } = themeCss({ dark: { backgroud: '#111' } });
  assert.strictEqual(css.includes('#111'), false);
  assert.match(errors[0], /backgroud/);
});

test('extra css is appended; a theme with nothing in it gives no css', () => {
  assert.match(themeCss({ css: '.x { color: red }' }).css, /\.x \{ color: red \}/);
  assert.strictEqual(themeCss({ name: 'Empty' }).css.trim(), '');
});

test('themes are listed from every folder, a later folder overriding the same id, sorted by name', () => {
  const a = tmp(); const b = tmp();
  write(a, 'codex.json', { name: 'Codex' });
  write(a, 'zed.json', { name: 'Aardvark' });
  write(b, 'codex.json', { name: 'Codex (mine)' });
  write(b, 'notes.txt', 'ignored');
  const list = listThemes([a, b, path.join(a, 'missing')]);
  assert.deepStrictEqual(list.map((t) => [t.id, t.name]), [['zed', 'Aardvark'], ['codex', 'Codex (mine)']]);
});

test('a theme file that is not valid JSON is listed with an error instead of breaking the list', () => {
  const a = tmp();
  write(a, 'broken.json', '{ nope');
  write(a, 'ok.json', { name: 'OK' });
  const list = listThemes([a]);
  assert.strictEqual(list.length, 2);
  assert.ok(list.find((t) => t.id === 'broken').error);
});

test('config defaults to the default theme when missing or corrupt', () => {
  const d = tmp();
  assert.strictEqual(readConfig(path.join(d, 'config.json')).theme, 'default');
  write(d, 'config.json', '{ nope');
  assert.strictEqual(readConfig(path.join(d, 'config.json')).theme, 'default');
});

test('writing the config merges with what is there', () => {
  const d = tmp();
  const f = path.join(d, 'config.json');
  write(d, 'config.json', { theme: 'default', extensions: { a: true } });
  writeConfig(f, { theme: 'codex' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { theme: 'codex', extensions: { a: true } });
});

test('resolving the configured theme gives its css; an unknown or default id gives none', () => {
  const a = tmp();
  write(a, 'codex.json', { name: 'Codex', dark: { background: '#111111' } });
  const c = tmp();
  const cfg = path.join(c, 'config.json');
  write(c, 'config.json', { theme: 'codex' });
  const r = resolveTheme([a], cfg);
  assert.strictEqual(r.current, 'codex');
  assert.match(r.css, /#111111/);
  assert.deepStrictEqual(r.themes.map((t) => t.id), ['codex']);
  write(c, 'config.json', { theme: 'gone' });
  assert.strictEqual(resolveTheme([a], cfg).css, '');
  assert.strictEqual(resolveTheme([a], cfg).current, 'default');
});

test('a window material is passed through when it is a known macOS material, and refused otherwise', () => {
  const a = tmp(); const c = tmp();
  write(a, 'glass.json', { name: 'Glass', window: { vibrancy: 'under-window' } });
  write(a, 'bad.json', { name: 'Bad', window: { vibrancy: 'rm -rf' } });
  write(c, 'config.json', { theme: 'glass' });
  assert.deepStrictEqual(resolveTheme([a], path.join(c, 'config.json')).window, { vibrancy: 'under-window' });
  write(c, 'config.json', { theme: 'bad' });
  const r = resolveTheme([a], path.join(c, 'config.json'));
  assert.strictEqual(r.window, null);
  assert.match(r.errors.join(), /vibrancy/);
});

test('frame sets the page frame behind the main area', () => {
  assert.match(themeCss({ dark: { frame: 'transparent' } }).css, /--df-bg-page: transparent !important/);
});

test('extra css may not import or load anything from outside (no @import, only data: urls)', () => {
  const bad = themeCss({ css: '@import url("https://x.example/a.css"); .a { color: red }' });
  assert.strictEqual(bad.css.includes('@import'), false);
  assert.match(bad.errors.join(), /css/);
  const remote = themeCss({ css: '.a { background: url(https://x.example/p.png) }' });
  assert.strictEqual(remote.css.includes('x.example'), false);
  const ok = themeCss({ css: '.a { background: url("data:image/png;base64,AAAA") }' });
  assert.match(ok.css, /data:image\/png/);
});

test('colour values may only use colour functions; urls, quotes, escapes and comments are refused', () => {
  for (const bad of ['url(https://x.example/p.png)', 'image-set("https://x.example/a.png" 1x)', '-webkit-image-set(url(a.png) 1x)', 'u\\72 l(https://x)', 'red /* x', '"red"', 'expression(alert(1))']) {
    const { css, errors } = themeCss({ dark: { background: bad } });
    assert.strictEqual(css.includes('--cds-surface-1'), false, bad);
    assert.strictEqual(errors.length, 1, bad);
  }
  for (const ok of ['#111', 'transparent', 'rgb(0 0 0 / 0.5)', 'rgba(10, 10, 12, 0.42)', 'hsl(240 5% 10%)', 'color-mix(in srgb, #fff 10%, transparent)', 'var(--cds-surface-2)', 'oklch(0.2 0.01 260)', 'light-dark(#fff, #000)']) {
    assert.deepStrictEqual(themeCss({ dark: { background: ok } }).errors, [], ok);
  }
  assert.strictEqual(themeCss({ dark: { vars: { '--x': 'url(https://x.example)' } } }).errors.length, 1);
});

test('extra css with escapes, image-set or @font-face is refused', () => {
  for (const bad of ['.a { background: u\\72 l(https://x) }', '.a { background: image-set("https://x" 1x) }', '@font-face { src: local(x) }', '.a { background: cross-fade(a, b) }', '@\\69mport "https://x";']) {
    const r = themeCss({ css: bad });
    assert.strictEqual(r.css.trim(), '', bad);
    assert.strictEqual(r.errors.length, 1, bad);
  }
});

test('a theme file called default.json is ignored (Default means Claude\'s own colours)', () => {
  const a = tmp();
  write(a, 'default.json', { name: 'Sneaky' });
  write(a, 'ok.json', { name: 'OK' });
  assert.deepStrictEqual(listThemes([a]).map((x) => x.id), ['ok']);
});
