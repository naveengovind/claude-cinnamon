// Entry point: bun core/apply/main.ts apply [--keep]  |  autoapply <claude pid>  (the login helper runs the latter
// through core/autoapply.sh). Settings come from the environment: CINNAMON_ROOT / CM_DIR (the install),
// CINNAMON_HOME (your folder), CM_STATE, CM_HELPER, CM_PRESS_TIMEOUT, CM_LOCK_WAIT, CM_LOCK_HELD.
import os from 'node:os';
import path from 'node:path';
import { Applier } from './Applier';
import { AutoApplier } from './AutoApplier';
import { RealSystem } from './System';

export function fromEnv(env = process.env) {
  const root = env.CM_DIR || env.CINNAMON_ROOT || path.join(import.meta.dir, '..', '..');
  const user = env.CINNAMON_HOME || path.join(os.homedir(), '.config', 'claude-cinnamon');
  const stateDir = env.CM_STATE || path.join(user, 'state');
  const sys = new RealSystem(env.CM_HELPER || path.join(user, 'helper', 'Cinnamon Helper.app', 'Contents', 'MacOS', 'cinnamon-helper'));
  const lockWait = env.CM_LOCK_WAIT ? Number(env.CM_LOCK_WAIT) : 90;
  const applier = new Applier(sys, { root, stateDir, pressTimeout: env.CM_PRESS_TIMEOUT ? Number(env.CM_PRESS_TIMEOUT) : 60, lockWait });
  return { sys, applier, auto: new AutoApplier(sys, applier, stateDir, lockWait) };
}

if (import.meta.main) {
  const [cmd, arg] = process.argv.slice(2);
  const { applier, auto } = fromEnv();
  const code = cmd === 'autoapply' && arg
    ? await auto.run(arg)
    : cmd === 'apply'
      ? await applier.run({ keep: process.argv.includes('--keep'), lockHeld: !!process.env.CM_LOCK_HELD })
      : (console.error('usage: core/apply/main.ts apply [--keep] | autoapply <claude pid>'), 64);
  process.exit(code);
}
