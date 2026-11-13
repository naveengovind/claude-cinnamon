// Printing for the cinnamon command: plain text, colours only on a terminal (and never with NO_COLOR).
import readline from 'node:readline';

export class Output {
  private readonly color = !process.env.NO_COLOR && !!process.stdout.isTTY;
  private paint = (code: number) => (s: unknown): string => (this.color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  readonly bold = this.paint(1);
  readonly dim = this.paint(2);
  readonly green = this.paint(32);
  readonly red = this.paint(31);
  readonly yellow = this.paint(33);

  say(...a: unknown[]): void { console.log(...a); }
  /** Prints the problem and returns the exit code 1. */
  fail(msg: string): number { console.error(this.red(`✗ ${msg}`)); return 1; }
  liveNote(): void { this.say(this.dim('Applies within a second if Claude is running with Cinnamon.')); }

  async confirm(question: string, yes: boolean): Promise<boolean> {
    if (yes) return true;
    if (!process.stdin.isTTY) { console.error(this.yellow('Not asking without a terminal; add --yes to go ahead.')); return false; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((r) => rl.question(`${question} [y/N] `, r));
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
  }
}
