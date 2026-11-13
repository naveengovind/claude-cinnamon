// Shared test helpers.
import path from 'node:path';

export const ROOT = path.join(import.meta.dir, '..');
const cache = new Map<string, string>();

/** Page code as Claude gets it: bundled by Bun into a self-contained browser script (safe to run twice). */
export async function pageCode(rel: string): Promise<string> {
  const file = path.join(ROOT, rel);
  const hit = cache.get(file);
  if (hit) return hit;
  const r = await Bun.build({ entrypoints: [file], target: 'browser', format: 'iife' });
  if (!r.success) throw new Error(r.logs.join('\n'));
  const code = await r.outputs[0]!.text();
  cache.set(file, code);
  return code;
}
