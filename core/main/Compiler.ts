// Loads extension code for the main process. Plain .js / .cjs / .css files are read as they are; TypeScript is
// compiled by spawning the compiler command from the config (an argv prefix: `[<bun>, 'build']` today), with
//   page code   <file> --target=browser --format=iife --metafile=<json>
//   main parts  <file> --target=node --format=cjs --metafile=<json>
// and the output read from its stdout. Any other compiler passed in the config must accept the same arguments.
//
// Safety for code from elsewhere: the extension folder is compiled from a copy placed under a `node_modules` folder
// (Bun refuses to run macros — code executed at build time — from there), and every file that went into the
// bundle (from the metafile) must really be inside that copy, so an import can't pull in a file from elsewhere on
// this Mac. Without a readable metafile nothing is accepted.
//
// Results are cached by path, kind and the size and time of every file that went in.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CompiledEntry } from './types';

export type CodeKind = 'page' | 'main';
const FLAGS: Record<CodeKind, string[]> = {
  page: ['--target=browser', '--format=iife'],
  main: ['--target=node', '--format=cjs'],
};
const CACHE_VERSION = 1;
const TIME_LIMIT_MS = 60_000;

const stampOf = (file: string): string => { try { const st = fs.statSync(file); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; } };
const isInside = (dir: string, file: string): boolean => file === dir || file.startsWith(dir + path.sep);

export class Compiler {
  constructor(private readonly command: string[] | null, private readonly cache: Map<string, CompiledEntry>) {}

  /** The code to run for `file`, which lies inside the extension folder `dir`. Throws with a short reason. */
  async load(file: string, kind: CodeKind, dir: string): Promise<string> {
    if (!file.endsWith('.ts')) return fs.readFileSync(file, 'utf8');
    const key = `${CACHE_VERSION}:${kind}:${file}`;
    const hit = this.cache.get(key);
    if (hit && hit.inputs.every((i) => stampOf(i.file) === i.stamp)) return hit.code;
    const entry = await this.compile(file, kind, dir);
    this.cache.set(key, entry);
    return entry.code;
  }

  private async compile(file: string, kind: CodeKind, dir: string): Promise<CompiledEntry> {
    if (!this.command?.length) throw new Error('needs a TypeScript compiler, and none is set up');
    const realDir = fs.realpathSync(dir);
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cinnamon-compile-')));
    try {
      const copy = path.join(work, 'node_modules', 'extension');
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      const stamps = new Map<string, string>(); // file in the copy → stamp of the original, taken as it is copied
      fs.cpSync(realDir, copy, {
        recursive: true,
        filter: (src) => {
          if (path.basename(src) === '.git') return false;
          stamps.set(path.join(copy, path.relative(realDir, src)), stampOf(src));
          return true;
        },
      });
      const metafile = path.join(work, 'meta.json');
      const entry = path.join(copy, path.relative(dir, file));
      const [cmd, ...prefix] = this.command;
      const code = await this.run(cmd!, [...prefix, entry, ...FLAGS[kind], `--metafile=${metafile}`], work);
      let inputs: Record<string, unknown>;
      try { inputs = (JSON.parse(fs.readFileSync(metafile, 'utf8')) as { inputs: Record<string, unknown> }).inputs; } catch { throw new Error('failed to compile (the compiler gave no metafile)'); }
      if (!inputs || typeof inputs !== 'object' || !Object.keys(inputs).length) throw new Error('failed to compile (the compiler gave no inputs)');
      const used: CompiledEntry['inputs'] = [];
      for (const name of Object.keys(inputs)) {
        let real: string;
        try { real = fs.realpathSync(path.resolve(work, name)); } catch { throw new Error(`refused: it uses ${name}, which is not a file in the extension`); }
        if (!isInside(copy, real)) throw new Error(`refused: it uses ${name}, which is outside the extension`);
        used.push({ file: path.join(dir, path.relative(copy, real)), stamp: stamps.get(real) ?? '-' });
      }
      return { code, inputs: used };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  private run(cmd: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { cwd, timeout: TIME_LIMIT_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err) {
          const why = String(stderr || err.message).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' ');
          reject(new Error(`failed to compile: ${why}`));
        } else resolve(stdout);
      });
    });
  }
}
