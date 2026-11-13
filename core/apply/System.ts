// The outside world the Applier uses — processes, the debugger port, AppleScript, Cinnamon Helper — behind one
// interface, so tests can replace it.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

export interface HelperResult { status: number; stdout: string }

export interface System {
  /** Your Claude's main process. */
  claudePid(): string | null;
  /** The pid listening on a local TCP port. */
  listener(port: number): string | null;
  /** A process's start time (`ps -o lstart=`), to tell a restarted Claude from the same one. */
  lstart(pid: string): string;
  osascript(args: string[]): string;
  osascriptAsync(args: string[]): Promise<string>;
  helperExists(): boolean;
  helper(args: string[]): HelperResult;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

export class RealSystem implements System {
  constructor(private readonly helperPath: string) {}

  private run(cmd: string, args: string[]): { status: number; stdout: string; stderr: string } {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  }

  claudePid(): string | null { return this.run('pgrep', ['-u', String(process.getuid!()), '-x', 'Claude']).stdout.trim().split('\n')[0] || null; }
  listener(port: number): string | null { return this.run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).stdout.trim().split('\n')[0] || null; }
  lstart(pid: string): string { return this.run('ps', ['-o', 'lstart=', '-p', pid]).stdout.trim(); }
  osascript(args: string[]): string { return this.run('osascript', args).stdout.trim(); }

  osascriptAsync(args: string[]): Promise<string> {
    return new Promise((resolve) => {
      const p = spawn('osascript', args);
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err += d; });
      p.on('close', () => resolve((out || err).trim()));
      p.on('error', (e) => resolve(String(e)));
    });
  }

  helperExists(): boolean { try { fs.accessSync(this.helperPath, fs.constants.X_OK); return true; } catch { return false; } }

  helper(args: string[]): HelperResult {
    const r = spawnSync(this.helperPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    return { status: r.status ?? 1, stdout: r.stdout || '' };
  }

  sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
  log(line: string): void { console.log(line); }
}
