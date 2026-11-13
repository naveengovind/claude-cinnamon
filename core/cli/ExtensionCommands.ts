// cinnamon ext [list] | enable|disable <id> | install <source> | remove <id>
import fs from 'node:fs';
import path from 'node:path';
import { Config } from '../lib/Config';
import { ExtensionCatalog, type ExtensionEntry, type Manifest } from '../lib/ExtensionCatalog';
import type { Output } from './Output';
import type { Paths } from './Paths';
import { SourceFetcher } from './SourceFetcher';

export class ExtensionCommands {
  private readonly catalog: ExtensionCatalog;
  private readonly config: Config;

  constructor(private readonly paths: Paths, private readonly out: Output, private readonly fetcher = new SourceFetcher()) {
    this.catalog = new ExtensionCatalog({ bundled: paths.bundledExtensions, user: paths.extensions });
    this.config = new Config(paths.config);
  }

  all(): ExtensionEntry[] { return this.catalog.list(); }

  list(): number {
    const { out } = this;
    const cfg = this.config.read();
    for (const e of this.all()) {
      const on = ExtensionCatalog.isEnabled(e, cfg);
      out.say(`${on ? out.green('on ') : out.dim('off')}  ${e.id.padEnd(18)} ${e.name}${e.bundled ? out.dim(' (built in)') : ''}${e.error ? out.red(`  (couldn't load: ${e.error})`) : ''}`);
    }
    return 0;
  }

  setEnabled(id: string, enabled: boolean): number {
    const e = this.all().find((x) => x.id === id);
    if (!e) return this.out.fail(`no extension "${id}" (see: cinnamon ext list)`);
    if (e.error) return this.out.fail(`${id} couldn't load: ${e.error}`);
    const cfg = this.config.read();
    this.config.write({ extensions: { ...((cfg.extensions as Record<string, unknown>) || {}), [id]: enabled } });
    this.out.say(this.out.green(`✓ ${id} ${enabled ? 'on' : 'off'}`));
    this.out.liveNote();
    return 0;
  }

  async install(raw: string, yes: boolean): Promise<number> {
    const { out } = this;
    let src;
    try { src = this.fetcher.fetch(raw); } catch (e) { return out.fail((e as Error).message); }
    try {
      let manifest: Manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(src.dir, 'manifest.json'), 'utf8')) as Manifest; } catch { return out.fail(`no manifest.json in ${src.url}${src.sub ? `#${src.sub}` : ''}`); }
      const links = SourceFetcher.findLinks(src.dir);
      if (links.length) return out.fail(`refusing to install: it contains links (${links.slice(0, 3).join(', ')}), which could point at other files on this Mac`);
      const id = SourceFetcher.sanitizeId(typeof manifest.id === 'string' && manifest.id ? manifest.id : (src.sub ? path.basename(src.sub) : path.basename(src.url)));
      if (!id) return out.fail('could not work out an id for this extension (add "id" to its manifest)');
      if (fs.existsSync(path.join(this.paths.bundledExtensions, id))) return out.fail(`"${id}" is the name of a built-in extension; pick another id in its manifest`);
      const name = typeof manifest.name === 'string' && manifest.name ? manifest.name : id;
      const loaded = ExtensionCatalog.load({ id, dir: src.dir, bundled: false, manifest, name, description: '' });
      out.say(`${out.bold(name)} ${out.dim(`(${id})`)}${manifest.version ? out.dim(` v${String(manifest.version)}`) : ''}`);
      if (manifest.description) out.say(`  ${String(manifest.description)}`);
      out.say(`  from ${src.url}${src.sub ? `#${src.sub}` : ''}${src.commit ? out.dim(` @ ${src.commit.slice(0, 12)}`) : ''}`);
      out.say(`  page code: ${loaded.page.length} file(s), styles: ${loaded.css.length} file(s)`);
      for (const err of loaded.errors) out.say(out.yellow(`  ! ${err}`));
      if (manifest.main !== undefined) out.say(out.yellow('  ! its "main" part is ignored: downloaded extensions run in the page only'));
      out.say(out.yellow('  It runs inside Claude\'s window and can read anything shown there. Only install extensions you trust.'));
      if (!(await out.confirm(`Install ${id}?`, yes))) return 1;
      const dest = path.join(this.paths.extensions, id);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(this.paths.extensions, { recursive: true });
      SourceFetcher.copyTree(src.dir, dest);
      fs.writeFileSync(path.join(dest, '.cinnamon-source.json'), `${JSON.stringify({ source: raw, url: src.url, ref: src.ref, sub: src.sub, commit: src.commit, installedAt: new Date().toISOString() }, null, 2)}\n`);
      out.say(out.green(`✓ installed ${id}`));
      out.liveNote();
      return 0;
    } finally { src.cleanup(); }
  }

  remove(id: string): number {
    const e = this.all().find((x) => x.id === id);
    if (!e) return this.out.fail(`no extension "${id}"`);
    if (e.bundled) return this.out.fail(`${id} is built in; turn it off instead: cinnamon ext disable ${id}`);
    fs.rmSync(e.dir, { recursive: true, force: true });
    const exts = this.config.read().extensions as Record<string, unknown> | undefined;
    if (exts && id in exts) { const rest = { ...exts }; delete rest[id]; this.config.write({ extensions: rest }); }
    this.out.say(this.out.green(`✓ removed ${id}`));
    return 0;
  }
}
