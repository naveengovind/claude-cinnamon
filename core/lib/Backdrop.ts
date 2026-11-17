// A theme's backdrop: what goes behind the conversation, written once in the shapes of Claude Code's theme API
// ($.theme.set's `backdrop`), so it reaches every place that can draw it:
//   - the Claude apps draw it themselves where Claude Code's theme API reaches (the desktop app's Code tab and the
//     mobile app), through the cinnamon-colors mod: `api` (and, for a live scene, `scene`, which the mod draws);
//   - Cinnamon draws the same thing everywhere else in the desktop app, as CSS: `layers`.
//
// In a theme file:
//   "backdrop": { "svg": "sun.svg" | "<svg …>", "glass": { "blur", "tint", "opacity" } | false, "alt": "…" }
//                 a live scene: an SVG (animated with CSS inside it), with the glass the app lays over it
//   "backdrop": { "color": … } | { "gradient": { "stops", "angle"?, "shape"?, "size"?, "repeat"? } }
//             | { "vector": { "viewBox", "paths", "color"?, … } } | { "image": { "source": "bg.jpg", "size"?, "repeat"? } }
//                 a still ground, exactly as the API takes it (colors: #hex, rgb(), hsl(), `transparent`, or one of the
//                 app's color names such as `surface-0`, which follows its mode)
// Files are read from the theme's own folder. Nothing that could run or load anything is accepted: an SVG with a
// script, event handlers, foreign content or links outside itself is refused.
import fs from 'node:fs';
import path from 'node:path';

export interface ResolvedBackdrop {
  /** What `$.theme.set({ backdrop })` takes (an image's source is where the mod's folder holds the copy). */
  api: Record<string, unknown>;
  /** A live scene the mod draws at the Backdrop render site. */
  scene: { name: string; svg: string; alt: string } | null;
  /** A picture to copy into the mod's folder. */
  asset: { from: string; to: string } | null;
  /** The same backdrop as a CSS `background` value (layers, top first), for Cinnamon to paint. */
  layers: string;
}

const NAMES = new Set(['surface-0', 'surface-1', 'surface-2', 'surface-3', 'text-primary', 'text-secondary', 'text-muted', 'text-disabled',
  'fill-primary', 'on-primary', 'border', 'border-strong', 'border-stronger', 'fill-accent', 'text-accent', 'bg-accent', 'on-accent',
  'border-accent', 'fill-danger', 'text-danger', 'bg-danger', 'on-danger', 'border-danger', 'fill-success', 'text-success', 'bg-success',
  'on-success', 'border-success', 'fill-warning', 'text-warning', 'bg-warning', 'on-warning', 'border-warning', 'fill-pro', 'text-pro',
  'bg-pro', 'on-pro', 'border-pro']);
const RAW = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([0-9.,%\s/deg+-]+\))$/i;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]+$/;
const SVG_MAX = 131_072;
const IMAGE_MAX = 1024 * 1024;
const KINDS = ['svg', 'color', 'gradient', 'vector', 'image'] as const;

class Refused extends Error {}
const refuse = (msg: string): never => { throw new Refused(msg); };
const num = (v: unknown, min: number, max: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) refuse(`${what} must be a number from ${min} to ${max}`);
  return v as number;
};

export class Backdrop {
  /** The theme's backdrop, checked, in both forms; or null (and why, when it was refused). */
  static resolve(theme: { backdrop?: unknown; [key: string]: unknown } | null | undefined, dir: string, themeId: string): { backdrop: ResolvedBackdrop | null; errors: string[] } {
    const b = theme?.backdrop;
    if (b === undefined || b === null) return { backdrop: null, errors: [] };
    try {
      if (typeof b !== 'object' || Array.isArray(b)) refuse('must be an object');
      const spec = b as Record<string, unknown>;
      const kinds = KINDS.filter((k) => spec[k] !== undefined);
      if (kinds.length !== 1) refuse(`give exactly one of ${KINDS.join(', ')}`);
      if (spec.glass !== undefined && kinds[0] !== 'svg') refuse('glass goes with a live scene (svg) only');
      switch (kinds[0]) {
        case 'svg': return { backdrop: Backdrop.scene(spec, dir, themeId), errors: [] };
        case 'color': {
          const c = Backdrop.color(spec.color, 'color');
          return { backdrop: { api: { color: c }, scene: null, asset: null, layers: `linear-gradient(${Backdrop.css(c)}, ${Backdrop.css(c)})` }, errors: [] };
        }
        case 'gradient': return { backdrop: Backdrop.gradient(spec.gradient), errors: [] };
        case 'vector': return { backdrop: Backdrop.vector(spec.vector), errors: [] };
        default: return { backdrop: Backdrop.image(spec.image, dir), errors: [] };
      }
    } catch (e) {
      if (e instanceof Refused) return { backdrop: null, errors: [`backdrop: ${e.message}`] };
      return { backdrop: null, errors: [`backdrop: ${(e as Error).message || e}`] };
    }
  }

  /** A raw color or one of the app's names, as the API accepts it. */
  private static color(v: unknown, what: string): string {
    if (typeof v !== 'string' || !(v === 'transparent' || NAMES.has(v) || RAW.test(v.trim()))) refuse(`${what}: ${JSON.stringify(v)} is not a color the app accepts (#hex, rgb(), hsl(), transparent or one of its color names)`);
    return (v as string).trim();
  }

  /** A color for CSS: the app's names are its CSS variables. */
  private static css(c: string): string { return NAMES.has(c) ? `var(--cds-${c})` : c; }

  /** A color for inside an SVG image, where CSS variables don't reach. */
  private static svgColor(c: string): string { return NAMES.has(c) ? '#808080' : c; }

  private static inside(dir: string, rel: unknown, what: string): string {
    if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) refuse(`${what} must be a file inside the theme's folder`);
    const full = path.resolve(dir, rel as string);
    const real = fs.realpathSync(full);
    if (!real.startsWith(fs.realpathSync(dir) + path.sep)) refuse(`${what} must be a file inside the theme's folder`);
    return real;
  }

  private static tiling(t: Record<string, unknown>): { api: Record<string, unknown>; css: string | null; repeat: boolean } {
    const api: Record<string, unknown> = {};
    let css: string | null = null;
    if (t.size !== undefined) {
      if (!Array.isArray(t.size) || t.size.length !== 2) refuse('size must be [width, height]');
      const [w, h] = (t.size as unknown[]).map((n) => num(n, 1, 256, 'size'));
      api.size = [w, h];
      css = `${w}px ${h}px`;
    }
    if (t.repeat !== undefined) { if (typeof t.repeat !== 'boolean') refuse('repeat must be true or false'); api.repeat = t.repeat; }
    return { api, css, repeat: t.repeat === true };
  }

  private static scene(spec: Record<string, unknown>, dir: string, themeId: string): ResolvedBackdrop {
    const raw = spec.svg;
    if (typeof raw !== 'string') refuse('svg must be SVG markup or a file name');
    let svg = raw as string;
    if (!svg.trim().startsWith('<')) svg = fs.readFileSync(Backdrop.inside(dir, svg, 'svg'), 'utf8');
    if (svg.length > SVG_MAX) refuse(`svg is over ${SVG_MAX} characters`);
    if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) refuse('svg must start with <svg');
    if (/<script|<foreignObject|\son[a-z]+\s*=|@import/i.test(svg)) refuse('svg may not have scripts, event handlers, foreign content or @import');
    if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg) || /url\(\s*['"]?(?!#)/i.test(svg)) refuse('svg may only link to parts of itself (#id)');
    const alt = typeof spec.alt === 'string' ? spec.alt.slice(0, 200) : '';
    const name = `cinnamon-${themeId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
    const api: Record<string, unknown> = { scene: name };
    let veil: string | null = null;
    if (spec.glass === false) api.glass = false;
    else if (spec.glass !== undefined) {
      if (typeof spec.glass !== 'object' || spec.glass === null || Array.isArray(spec.glass)) refuse('glass must be { blur, tint, opacity } or false');
      const g = spec.glass as Record<string, unknown>;
      const glass: Record<string, unknown> = {};
      if (g.blur !== undefined) glass.blur = num(g.blur, 0, 64, 'glass.blur');
      if (g.tint !== undefined) {
        if (typeof g.tint !== 'string' || !RAW.test(g.tint.trim())) refuse('glass.tint must be a raw color (#hex, rgb(), hsl()): the app refuses names there');
        glass.tint = (g.tint as string).trim();
      }
      if (g.opacity !== undefined) glass.opacity = num(g.opacity, 0, 1, 'glass.opacity');
      api.glass = glass;
      // the veil the mobile app lays over a scene, which Cinnamon draws the same way
      if (glass.tint) veil = Backdrop.veil(glass.tint as string, (glass.opacity as number | undefined) ?? 0.6);
    }
    const url = `url("data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}") center / cover no-repeat`;
    return { api, scene: { name, svg, alt }, asset: null, layers: veil ? `${veil}, ${url}` : url };
  }

  private static veil(tint: string, opacity: number): string {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(tint);
    let c: string;
    if (hex) {
      const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join('') : hex[1]!;
      c = `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${opacity})`;
    } else c = `color-mix(in srgb, ${tint} ${Math.round(opacity * 100)}%, transparent)`;
    return `linear-gradient(${c}, ${c})`;
  }

  private static gradient(v: unknown): ResolvedBackdrop {
    if (!v || typeof v !== 'object' || Array.isArray(v)) refuse('gradient must be { stops, angle?, shape?, size?, repeat? }');
    const g = v as Record<string, unknown>;
    if (!Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > 16) refuse('gradient.stops must be 2 to 16 colors');
    let last = -1;
    const css: string[] = [];
    const stops = (g.stops as unknown[]).map((s, i) => {
      if (s && typeof s === 'object') {
        const st = s as Record<string, unknown>;
        const at = num(st.at, 0, 1, 'gradient stop at');
        if (at < last) refuse('gradient stops must run in order');
        last = at;
        const c = Backdrop.color(st.color, `gradient stop ${i + 1}`);
        css.push(`${Backdrop.css(c)} ${Math.round(at * 1000) / 10}%`);
        return { at, color: c };
      }
      const c = Backdrop.color(s, `gradient stop ${i + 1}`);
      css.push(Backdrop.css(c));
      return c;
    });
    const api: Record<string, unknown> = { stops };
    if (g.angle !== undefined) api.angle = num(g.angle, -360, 360, 'gradient.angle');
    if (g.shape !== undefined) { if (g.shape !== 'linear' && g.shape !== 'radial') refuse('gradient.shape must be linear or radial'); api.shape = g.shape; }
    const t = Backdrop.tiling(g);
    Object.assign(api, t.api);
    const image = g.shape === 'radial' ? `radial-gradient(ellipse closest-side at center, ${css.join(', ')})` : `linear-gradient(${(api.angle as number | undefined) ?? 180}deg, ${css.join(', ')})`;
    return { api: { gradient: api }, scene: null, asset: null, layers: `${image} ${t.css ? `0 0 / ${t.css}` : 'center / 100% 100%'} ${t.repeat ? 'repeat' : 'no-repeat'}` };
  }

  private static vector(v: unknown): ResolvedBackdrop {
    if (!v || typeof v !== 'object' || Array.isArray(v)) refuse('vector must be { viewBox, paths, color?, size?, repeat? }');
    const g = v as Record<string, unknown>;
    let w: number, h: number;
    if (typeof g.viewBox === 'number') w = h = num(g.viewBox, 1, 256, 'vector.viewBox');
    else if (Array.isArray(g.viewBox) && g.viewBox.length === 2) { const vb = (g.viewBox as unknown[]).map((n) => num(n, 1, 256, 'vector.viewBox')); w = vb[0]!; h = vb[1]!; }
    else refuse('vector.viewBox must be a number or [width, height]');
    if (!Array.isArray(g.paths) || !g.paths.length || g.paths.length > 64) refuse('vector.paths must be 1 to 64 paths');
    const color = g.color === undefined ? null : Backdrop.color(g.color, 'vector.color');
    const svgPaths: string[] = [];
    const paths = (g.paths as unknown[]).map((p) => {
      const o = typeof p === 'string' ? { d: p } : (p && typeof p === 'object' ? p as Record<string, unknown> : refuse('a vector path is a string or { d, strokeWidth?, color? }') as never);
      const d = o.d;
      if (typeof d !== 'string' || !d.trim() || d.length > 16_384 || !PATH_DATA.test(d)) refuse('vector path d must be SVG path data (at most 16,384 characters)');
      const out: Record<string, unknown> = { d };
      let stroke: number | null = null;
      if (o.strokeWidth !== undefined) { stroke = num(o.strokeWidth, Number.MIN_VALUE, 64, 'vector strokeWidth'); out.strokeWidth = stroke; }
      const pc = o.color === undefined ? null : Backdrop.color(o.color, 'vector path color');
      if (pc) out.color = pc;
      const fill = Backdrop.svgColor(pc || color || 'transparent');
      svgPaths.push(stroke ? `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${stroke}" vector-effect="non-scaling-stroke"/>` : `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`);
      return typeof p === 'string' ? p : out;
    });
    const api: Record<string, unknown> = { viewBox: g.viewBox, paths };
    if (color) api.color = color;
    const t = Backdrop.tiling(g);
    Object.assign(api, t.api);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w!} ${h!}" width="${w!}" height="${h!}">${svgPaths.join('')}</svg>`;
    const url = `url("data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}")`;
    return { api: { vector: api }, scene: null, asset: null, layers: `${url} ${t.css ? `0 0 / ${t.css}` : 'center / auto'} ${t.repeat ? 'repeat' : 'no-repeat'}` };
  }

  private static image(v: unknown, dir: string): ResolvedBackdrop {
    if (!v || typeof v !== 'object' || Array.isArray(v)) refuse('image must be { source, size?, repeat? }');
    const g = v as Record<string, unknown>;
    const file = Backdrop.inside(dir, g.source, 'image.source');
    const bytes = fs.readFileSync(file);
    if (bytes.length > IMAGE_MAX) refuse('image is over 1 MiB');
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) refuse('image must be a PNG or a JPEG');
    const to = `assets/backdrop.${png ? 'png' : 'jpg'}`;
    const t = Backdrop.tiling(g);
    const url = `url("data:image/${png ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}")`;
    return {
      api: { image: { source: to, ...t.api } },
      scene: null,
      asset: { from: file, to },
      layers: `${url} ${t.css ? `0 0 / ${t.css}` : 'center / cover'} ${t.repeat ? 'repeat' : 'no-repeat'}`,
    };
  }
}
