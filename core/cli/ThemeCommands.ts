// cinnamon theme [list] | <id> | install <source> | remove <id>
import fs from 'node:fs';
import path from 'node:path';
import { Config } from '../lib/Config';
import { ThemeEngine, type Theme } from '../lib/ThemeEngine';
import { ThemeStore } from '../lib/ThemeStore';
import type { Output } from './Output';
import type { Paths } from './Paths';
import { SourceFetcher } from './SourceFetcher';

export class ThemeCommands {
  private readonly store: ThemeStore;
  private readonly config: Config;

  constructor(private readonly paths: Paths, private readonly out: Output, private readonly fetcher = new SourceFetcher()) {
    this.store = new ThemeStore([paths.bundledThemes, paths.themes]);
    this.config = new Config(paths.config);
  }

  list(): number {
    const { out } = this;
    const current = this.config.read().theme;
    const mark = (id: string) => (current === id ? out.green('*') : ' ');
    out.say(`${mark('default')} ${'default'.padEnd(16)} Default ${out.dim('(Claude\'s own colours)')}`);
    for (const t of this.store.list()) {
      out.say(`${mark(t.id)} ${t.id.padEnd(16)} ${t.name}${t.error ? out.red(`  (couldn't load: ${t.error})`) : ''}${t.description ? out.dim(`  ${t.description}`) : ''}`);
    }
    return 0;
  }

  set(id: string): number {
    if (id !== 'default' && !this.store.list().some((t) => t.id === id && !t.error)) return this.out.fail(`no theme "${id}" (see: cinnamon theme list)`);
    this.config.write({ theme: id });
    this.out.say(this.out.green(`✓ theme: ${id}`));
    this.out.liveNote();
    return 0;
  }

  async install(raw: string, yes: boolean): Promise<number> {
    const { out } = this;
    let src;
    try { src = this.fetcher.fetch(raw); } catch (e) { return out.fail((e as Error).message); }
    try {
      let dir = src.dir;
      const jsonIn = (d: string) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json'); } catch { return []; } };
      if (!jsonIn(dir).length && jsonIn(path.join(dir, 'themes')).length) dir = path.join(dir, 'themes');
      const good: { f: string; name: string }[] = [];
      for (const f of jsonIn(dir)) {
        if (fs.lstatSync(path.join(dir, f)).isSymbolicLink()) { out.say(out.yellow(`! ${f}: a link, skipped`)); continue; }
        let t: Theme;
        try { t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Theme; } catch { out.say(out.yellow(`! ${f}: not valid JSON, skipped`)); continue; }
        if (!t || typeof t !== 'object' || Array.isArray(t) || !(t.dark || t.light || t.css)) { out.say(out.dim(`  ${f}: not a theme, skipped`)); continue; }
        const { errors } = ThemeEngine.css(t);
        if (errors.length) { out.say(out.yellow(`! ${f}: skipped (${errors.join('; ')})`)); continue; }
        good.push({ f, name: typeof t.name === 'string' && t.name ? t.name : f });
      }
      if (!good.length) return out.fail('no theme files (*.json) found');
      out.say(`${out.bold('Themes')} from ${src.url}${src.commit ? out.dim(` @ ${src.commit.slice(0, 12)}`) : ''}:`);
      for (const g of good) out.say(`  ${g.f.replace(/\.json$/, '').padEnd(16)} ${g.name}`);
      out.say(out.dim('  Themes only change colours and styles; they can\'t run code or load anything from the internet.'));
      if (!(await out.confirm('Install these themes?', yes))) return 1;
      fs.mkdirSync(this.paths.themes, { recursive: true });
      for (const g of good) fs.copyFileSync(path.join(dir, g.f), path.join(this.paths.themes, `${SourceFetcher.sanitizeId(g.f.replace(/\.json$/, ''))}.json`));
      out.say(out.green(`✓ installed ${good.length} theme${good.length > 1 ? 's' : ''}`), out.dim('(pick one in Settings → Appearance → Color scheme, or: cinnamon theme <id>)'));
      return 0;
    } finally { src.cleanup(); }
  }

  remove(id: string): number {
    const f = path.join(this.paths.themes, `${SourceFetcher.sanitizeId(id)}.json`);
    if (!fs.existsSync(f)) return this.out.fail(`no installed theme "${id}" (bundled themes can't be removed)`);
    fs.rmSync(f);
    if (this.config.read().theme === id) this.config.write({ theme: 'default' });
    this.out.say(this.out.green(`✓ removed theme ${id}`));
    return 0;
  }
}
