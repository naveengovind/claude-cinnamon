// cinnamon screenshot [--out <file.png>] [--width <px>]: a picture of Claude's window, taken by the Cinnamon running
// inside Claude (core/main/RequestServer): this writes a request file and waits for the answer. No macOS permission
// and no debugger: Claude captures its own window. For checking a theme or an extension you just changed.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HelperClient } from './HelperClient';
import type { Output } from './Output';
import type { Paths } from './Paths';

interface Answer { ok?: boolean; png?: string; width?: number; height?: number; url?: string; error?: string }

export class Screenshot {
  constructor(private readonly paths: Paths, private readonly out: Output) {}

  async run(args: string[]): Promise<number> {
    const { out } = this;
    const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    const target = flag('--out');
    const width = flag('--width') ? Number(flag('--width')) : 1600;
    if (!Number.isFinite(width) || width < 200) return out.fail('--width takes a number of pixels (200 or more)');
    const timeout = Number(process.env.CINNAMON_SCREENSHOT_TIMEOUT_MS) || 15_000;

    const state = path.join(this.paths.user, 'state');
    const reqDir = path.join(state, 'requests');
    const resDir = path.join(state, 'responses');
    fs.mkdirSync(reqDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(reqDir, 0o700);
    const id = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
    const reqFile = path.join(reqDir, `${id}.json`);
    const tmp = `${reqFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ id, type: 'screenshot', width }) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, reqFile);

    const resFile = path.join(resDir, `${id}.json`);
    const end = Date.now() + timeout;
    let answer: Answer | null = null;
    while (Date.now() < end) {
      try { answer = JSON.parse(fs.readFileSync(resFile, 'utf8')) as Answer; break; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!answer) {
      fs.rmSync(reqFile, { force: true });
      const why = HelperClient.claudePid() ? 'Cinnamon isn\'t running inside Claude, or is older than 0.3.2' : 'Claude isn\'t running';
      return out.fail(`no picture: ${why}. See: cinnamon status (cinnamon apply re-injects it).`);
    }
    fs.rmSync(resFile, { force: true });
    if (!answer.ok || !answer.png) return out.fail(`no picture: ${answer.error || 'unknown error'}`);
    let file = answer.png;
    if (target) {
      const dest = path.resolve(target);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(answer.png, dest);
      fs.rmSync(answer.png, { force: true });
      file = dest;
    }
    out.say(file);
    out.say(out.dim(`  ${answer.width}×${answer.height}${answer.url ? `, showing ${answer.url}` : ''}`));
    return 0;
  }
}
