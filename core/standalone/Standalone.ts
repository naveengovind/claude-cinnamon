// The standalone cinnamon binary (built by scripts/build.ts with `bun build --compile`): Bun and all of Cinnamon's
// files are inside it, so nothing else needs installing. Each version unpacks its files into <your folder>/app/<version>
// on first run (see Payload) and runs from there exactly like an installed copy, with CINNAMON_BIN telling the rest of
// Cinnamon to use this binary wherever it would run Bun:
//   cinnamon __compile …     compiles extension TypeScript for Claude (in place of `bun build`)
//   cinnamon __autoapply <pid>  what the login item runs when Claude starts
//   cinnamon <anything else> the cinnamon command
import os from 'node:os';
import path from 'node:path';
import { compileCommand } from '../cli/Compile';
import { Payload } from './Payload';

export async function runStandalone(files: Record<string, string>, version: string, argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === '__compile') return compileCommand(rest); // needs no files: keep it quick
  if (cmd === '--version' || cmd === 'version') { console.log(version); return 0; }
  const user = process.env.CINNAMON_HOME || path.join(os.homedir(), '.config', 'claude-cinnamon');
  const payload = new Payload(files, version);
  const root = await payload.ensure(user);
  Object.assign(process.env, { CINNAMON_ROOT: root, CINNAMON_BIN: process.execPath, CINNAMON_VERSION: version });
  // loaded only now: the modules below read these settings
  if (cmd === '__autoapply') {
    const { fromEnv } = await import('../apply/main');
    return rest[0] ? fromEnv().auto.run(rest[0]) : 64;
  }
  const { Cli } = await import('../cli/Cli');
  const code = await new Cli().main(argv);
  if (cmd === 'install' && code === 0) payload.prune(user); // Claude now uses this version's files
  return code;
}
