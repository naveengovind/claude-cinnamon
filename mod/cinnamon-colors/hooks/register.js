// Cinnamon colors: a Claude Code mod that hands the theme picked in Cinnamon to the Claude apps through Claude Code's
// own theme API ($.theme.set), which the desktop app's Code tab and the mobile app draw. Cinnamon does the work: it
// turns the picked theme into look.json in this folder:
//   { id, colors?, backdrop?, overrideColorScheme?, scene?: { name, svg, alt } }
// `colors` is the app's palette, `backdrop` what goes behind the conversation (a still ground, or a scene this mod
// draws from `scene.svg` at the Backdrop render site), or { id: null } when the theme is one only Cinnamon can paint.
// This mod passes it on and follows changes. Where the app paints the current look, Cinnamon's own colors and backdrop
// step aside, so the two never fight.
//
// Installed by `cinnamon install` into ~/.claude/skills/cinnamon-colors (a plugin there loads in every local Claude
// Code session) and removed by `cinnamon uninstall`. Where nothing draws themes (the terminal, VS Code) it does
// nothing visible.

const EVERY_MS = 2000;

let shown = null; // the look id the app drew for this session, and for which attached apps
let shownTo = '';
let scene = null; // { name, svg, alt } of the current look, for the Backdrop render site
let timer = null;

async function readLook($) {
  try {
    return JSON.parse(await $.fs.read(`${$.plugin.root}/look.json`));
  } catch {
    return undefined; // no Cinnamon here, or no apply yet: leave the app alone
  }
}

async function sync($) {
  // only an app that paints themes (the desktop or mobile app) is attached here; it may attach after the start
  const surfaces = await $.session.surfaces();
  if (!surfaces.some((s) => s === 'desktop' || s === 'mobile')) return;
  const to = [...surfaces].sort().join(',');
  const look = await readLook($);
  if (look === undefined) return;
  const id = look && typeof look.id === 'string' && (look.colors || look.backdrop) ? look.id : null;
  if (id) {
    scene = look.scene && typeof look.scene.svg === 'string' ? look.scene : null;
    // again when another app attaches (the phone after the desktop, say), so each gets it
    if (id === shown && to === shownTo) return;
    const attrs = {};
    if (look.colors) attrs.colors = look.colors;
    if (look.backdrop) attrs.backdrop = look.backdrop;
    if (look.overrideColorScheme === 'light' || look.overrideColorScheme === 'dark') attrs.overrideColorScheme = look.overrideColorScheme;
    const set = await $.theme.set(attrs);
    if (set.isDrawn === true) {
      shown = id;
      shownTo = to;
      await $.store.set('painted', id);
      if (scene) $.ui.invalidate('ui.render');
    }
    return;
  }
  // The person picked a theme only Cinnamon paints. The app keeps a mod theme until it is cleared, so clear the one
  // this mod set (in this session or an earlier one), and never another mod's.
  shown = null;
  shownTo = '';
  scene = null;
  if (await $.store.get('painted')) {
    await $.theme.clear();
    await $.store.delete('painted');
  }
}

function tick($) {
  sync($).catch(() => {});
}

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on('session.start', async ($, e, next) => {
    await sync($).catch(() => {});
    if (timer) timer.cancel();
    timer = $.clock.every(EVERY_MS, () => tick($));
    return next(e);
  });

  // The look's live scene: an SVG (animated with CSS inside it), drawn behind the conversation by the desktop and
  // mobile apps under their glass.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    const name = e.props.scene ?? e.props.id;
    if (e.props.plugin !== $.plugin.name || !scene || name !== scene.name) return next(e);
    const { Svg } = $.ui.resolve(e);
    return Svg({ source: scene.svg, alt: scene.alt || 'Theme backdrop' });
  });
};
