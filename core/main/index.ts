// Entry point of the script Claude's main process evaluates (bundled by core/render.ts). `load` is the debugger's
// require, captured by the wrapper before anything awaits.
import { Cinnamon } from './Cinnamon';
import type { Load, MainConfig } from './types';

export function run(load: Load, config: MainConfig) {
  return new Cinnamon(load, config).start();
}
