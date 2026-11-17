// A theme's backdrop: one definition, in the shapes of Claude Code's theme API, for both painters. The app (through
// the cinnamon-colors mod) draws it in the Code tab and the mobile app; Cinnamon draws the same thing everywhere else.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backdrop } from '../core/lib/Backdrop';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-backdrop-'));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="xMidYMid slice"><style>@keyframes a{to{opacity:.5}} rect{animation:a 2s infinite}</style><rect width="10" height="10" fill="#f80"/></svg>';

test('a scene from an SVG file: a named scene with glass for the app, the SVG for both painters', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'sun.svg'), SVG);
  const { backdrop, errors } = Backdrop.resolve({ backdrop: { svg: 'sun.svg', glass: { blur: 12, tint: '#1a0902', opacity: 0.5 }, alt: 'A sun' } }, d, 'ember');
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(backdrop!.api, { scene: 'cinnamon-ember', glass: { blur: 12, tint: '#1a0902', opacity: 0.5 } });
  assert.deepStrictEqual(backdrop!.scene, { name: 'cinnamon-ember', svg: SVG, alt: 'A sun' });
  assert.match(backdrop!.layers, /url\("data:image\/svg\+xml;base64,/);
  assert.match(backdrop!.layers, /linear-gradient\(rgba\(26, 9, 2, 0\.5\), rgba\(26, 9, 2, 0\.5\)\)/, 'the glass veil over it, as the phone draws it');
});

test('an inline SVG works too', () => {
  const { backdrop } = Backdrop.resolve({ backdrop: { svg: SVG } }, dir(), 'x');
  assert.strictEqual(backdrop!.scene!.svg, SVG);
  assert.deepStrictEqual(backdrop!.api, { scene: 'cinnamon-x' });
});

test('an SVG that could run or load something is refused', () => {
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><image href="https://e.com/a.png"/></svg>', '<svg><foreignObject/></svg>', 'not svg']) {
    const { backdrop, errors } = Backdrop.resolve({ backdrop: { svg: bad } }, dir(), 'x');
    assert.strictEqual(backdrop, null, bad);
    assert.ok(errors.length, bad);
  }
});

test('an SVG file outside the theme folder is refused', () => {
  const { backdrop, errors } = Backdrop.resolve({ backdrop: { svg: '../secret.svg' } }, dir(), 'x');
  assert.strictEqual(backdrop, null);
  assert.match(errors[0]!, /inside/);
});

test('still grounds pass through in the API shape, and Cinnamon draws them as CSS', () => {
  const c = Backdrop.resolve({ backdrop: { color: 'surface-0' } }, dir(), 'x').backdrop!;
  assert.deepStrictEqual(c.api, { color: 'surface-0' });
  assert.match(c.layers, /var\(--cds-surface-0\)/, 'a name follows the app\'s own color');
  const g = Backdrop.resolve({ backdrop: { gradient: { stops: ['#000000', { at: 1, color: '#ff7a1a' }], angle: 160 } } }, dir(), 'x').backdrop!;
  assert.deepStrictEqual(g.api, { gradient: { stops: ['#000000', { at: 1, color: '#ff7a1a' }], angle: 160 } });
  assert.match(g.layers, /linear-gradient\(160deg, #000000, #ff7a1a 100%\)/);
  const r = Backdrop.resolve({ backdrop: { gradient: { stops: ['#000', '#fff'], shape: 'radial' } } }, dir(), 'x').backdrop!;
  assert.match(r.layers, /radial-gradient\(/);
  assert.strictEqual(g.scene, null);
});

test('a picture is copied for the app (from the mod\'s folder) and inlined for Cinnamon', () => {
  const d = dir();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010018dd8db40000000049454e44ae426082', 'hex');
  fs.writeFileSync(path.join(d, 'bg.png'), png);
  const { backdrop } = Backdrop.resolve({ backdrop: { image: { source: 'bg.png', size: [64, 64], repeat: true } } }, d, 'x');
  assert.deepStrictEqual(backdrop!.api, { image: { source: 'assets/backdrop.png', size: [64, 64], repeat: true } });
  assert.deepStrictEqual(backdrop!.asset, { from: fs.realpathSync(path.join(d, 'bg.png')), to: 'assets/backdrop.png' });
  assert.match(backdrop!.layers, /url\("data:image\/png;base64,/);
  assert.match(backdrop!.layers, /64px 64px/);
});

test('a picture over 1 MiB, or not a PNG or JPEG, is refused', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'big.png'), Buffer.alloc(1024 * 1024 + 1));
  fs.writeFileSync(path.join(d, 'a.gif'), 'GIF89a');
  assert.strictEqual(Backdrop.resolve({ backdrop: { image: { source: 'big.png' } } }, d, 'x').backdrop, null);
  assert.strictEqual(Backdrop.resolve({ backdrop: { image: { source: 'a.gif' } } }, d, 'x').backdrop, null);
});

test('exactly one kind, sensible glass, and colors the app accepts', () => {
  const r = (b) => Backdrop.resolve({ backdrop: b }, dir(), 'x');
  assert.strictEqual(r({ color: '#000', svg: SVG }).backdrop, null, 'two kinds');
  assert.strictEqual(r({ svg: SVG, glass: { opacity: 3 } }).backdrop, null);
  assert.strictEqual(r({ svg: SVG, glass: { tint: 'red' } }).backdrop, null, 'the app takes raw colors only for the tint');
  assert.deepStrictEqual(r({ svg: SVG, glass: false }).backdrop!.api, { scene: 'cinnamon-x', glass: false });
  assert.strictEqual(r({ color: 'url(x)' }).backdrop, null);
  assert.strictEqual(r({ color: '#123' }).errors.length, 0);
  assert.strictEqual(Backdrop.resolve({}, dir(), 'x').backdrop, null, 'no backdrop, nothing');
});
