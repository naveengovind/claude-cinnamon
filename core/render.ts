// Builds the script core/apply evaluates in Claude's main process: the main-process code (core/main) bundled by Bun
// into one CommonJS script, wrapped so that the debugger's `require` — usable only until the first await — is captured
// first and handed to it, with the paths and the compiled core page code (core/page) passed in as its config.
// Also a CLI: bun core/render.ts <cinnamon dir>  → prints the script.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionRoots } from './lib/ExtensionCatalog';
import type { MainConfig } from './main/types';

/** Where the user's own config, themes, extensions and data live (kept apart from the tool's code). */
export const USER_DIR = process.env.CINNAMON_HOME || path.join(os.homedir(), '.config', 'claude-cinnamon');

export interface RenderOptions {
  root: string;
  userDir?: string;
  themeDirs?: string[] | null;
  extRoots?: ExtensionRoots | null;
  /** argv prefix that compiles extension TypeScript inside Claude; default: see defaultCompiler. */
  compiler?: string[] | null;
}

/** The standalone binary compiles with its built-in Bun (`cinnamon __compile`); otherwise this Bun's `build`. */
export function defaultCompiler(env = process.env): string[] {
  return env.CINNAMON_BIN ? [env.CINNAMON_BIN, '__compile'] : [process.execPath, 'build'];
}

async function bundle(entry: string, target: 'node' | 'browser', format: 'cjs' | 'iife'): Promise<string> {
  const r = await Bun.build({ entrypoints: [entry], target, format, external: ['electron'] });
  if (!r.success) throw new Error(`could not build ${entry}:\n${r.logs.join('\n')}`);
  return r.outputs[0]!.text();
}

export async function renderMain({ root, userDir = USER_DIR, themeDirs = null, extRoots = null, compiler }: RenderOptions): Promise<string> {
  const core = path.join(root, 'core');
  const main = await bundle(path.join(core, 'main', 'index.ts'), 'node', 'cjs');
  const pageJs = [
    await bundle(path.join(core, 'page', 'runtime.ts'), 'browser', 'iife'),
    await bundle(path.join(core, 'page', 'settings-ui.ts'), 'browser', 'iife'),
  ].join('\n;\n');
  const config: MainConfig = {
    root, userDir, themeDirs, extRoots,
    compiler: compiler === undefined ? defaultCompiler() : compiler,
    page: { js: pageJs, css: fs.readFileSync(path.join(core, 'page', 'settings-ui.css'), 'utf8') },
  };
  return `(() => {
const load = require; // the debugger's require: usable only until the first await
const module = { exports: {} };
(function (module, exports, require) {
${main}
})(module, module.exports, load);
return module.exports.run(load, ${JSON.stringify(config)});
})()`;
}

if (import.meta.main) {
  const root = path.resolve(process.argv[2] || path.join(import.meta.dir, '..'));
  process.stdout.write(await renderMain({ root }));
}
