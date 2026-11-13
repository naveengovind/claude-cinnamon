// `cinnamon __compile <file> --target=browser|node --format=iife|cjs [--metafile=<json>]`: compiles TypeScript the way
// `bun build` does, for a standalone binary that has Bun built in (Claude's main process calls it to compile extension
// TypeScript — see core/main/Compiler.ts). Code goes to stdout; the input files go to the metafile.
import fs from 'node:fs';

export async function compileCommand(
  args: string[],
  write: (s: string) => void = (s) => { process.stdout.write(s); },
  error: (s: string) => void = (s) => { process.stderr.write(s); },
): Promise<number> {
  const entry = args.find((a) => !a.startsWith('--'));
  const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = opt('target') === 'node' ? 'node' : 'browser';
  const format = opt('format') === 'cjs' ? 'cjs' : 'iife';
  const metafile = opt('metafile');
  if (!entry) { error('usage: cinnamon __compile <file> --target=browser|node --format=iife|cjs [--metafile=<json>]\n'); return 64; }
  let r: Awaited<ReturnType<typeof Bun.build>>;
  try {
    r = await Bun.build({ entrypoints: [entry], target, format, metafile: true } as Parameters<typeof Bun.build>[0]);
  } catch (e) {
    error(`${(e as Error).message || e}\n`);
    return 1;
  }
  if (!r.success) { error(`${r.logs.map(String).join('\n')}\n`); return 1; }
  if (metafile) fs.writeFileSync(metafile, JSON.stringify((r as unknown as { metafile: unknown }).metafile));
  write(await r.outputs[0]!.text());
  return 0;
}
