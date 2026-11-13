// `cinnamon __compile`: what a standalone binary runs in place of `bun build` when Claude needs TypeScript compiled.
import { test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileCommand } from '../core/cli/Compile';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-comp-'));
  fs.writeFileSync(path.join(dir, 'dep.ts'), 'export const N: number = 41;');
  fs.writeFileSync(path.join(dir, 'page.ts'), "import { N } from './dep';\nconst add = (a: number): number => a + 1;\nconsole.log(add(N));");
  return dir;
}

test('compiles like `bun build`: code on stdout, the input files in the metafile', async () => {
  const dir = project();
  const meta = path.join(dir, 'meta.json');
  let out = '';
  const code = await compileCommand([path.join(dir, 'page.ts'), '--target=browser', '--format=iife', `--metafile=${meta}`], (s) => { out += s; });
  assert.strictEqual(code, 0);
  assert.match(out, /\(\(\) => \{/, 'an iife');
  assert.doesNotMatch(out, /: number/, 'types removed');
  const inputs = Object.keys(JSON.parse(fs.readFileSync(meta, 'utf8')).inputs).map((f) => path.basename(f)).sort();
  assert.deepStrictEqual(inputs, ['dep.ts', 'page.ts']);
});

test('node / cjs output for main parts', async () => {
  const dir = project();
  let out = '';
  assert.strictEqual(await compileCommand([path.join(dir, 'page.ts'), '--target=node', '--format=cjs', `--metafile=${path.join(dir, 'm.json')}`], (s) => { out += s; }), 0);
  assert.doesNotMatch(out, /^\(\(\) => \{/);
});

test('a broken file fails with the reason', async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'bad.ts'), 'const = ;');
  const errs: string[] = [];
  const code = await compileCommand([path.join(dir, 'bad.ts'), '--target=browser', '--format=iife'], () => {}, (s) => errs.push(s));
  assert.notStrictEqual(code, 0);
  assert.match(errs.join(''), /bad\.ts:1:\d+/, 'names the file and line, as `bun build` does');
});

test('an import that cannot be found is named', async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'lost.ts'), "import { x } from '../nowhere';\nconsole.log(x);");
  const errs: string[] = [];
  assert.notStrictEqual(await compileCommand([path.join(dir, 'lost.ts'), '--target=browser', '--format=iife'], () => {}, (s) => errs.push(s)), 0);
  assert.match(errs.join(''), /nowhere/);
  assert.match(errs.join(''), /lost\.ts/);
});
