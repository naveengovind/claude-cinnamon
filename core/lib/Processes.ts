// Finding the user's running Claude. `pgrep` on macOS leaves out its own ancestors unless given -a, and a Claude Code
// session in the desktop app runs inside Claude (Claude → claude → shell → cinnamon): without -a, every `cinnamon`
// command run from such a session would think Claude isn't running.
import { spawnSync } from 'node:child_process';

/** The oldest-listed pid of this user's process named exactly `name` (ancestors included), or null. */
export function pidOf(name: string): string | null {
  const r = spawnSync('pgrep', ['-a', '-u', String(process.getuid!()), '-x', name], { encoding: 'utf8' });
  return (r.stdout || '').trim().split('\n')[0] || null;
}
