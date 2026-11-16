// Cinnamon colours: a Claude Code mod that paints the Claude desktop app's Code tab with the colour scheme picked in
// Cinnamon, through the app's own theme API ($.theme.set). Cinnamon does the colour work: it turns the picked theme
// into the app's colour data and writes it to look.json in this folder as { id, colors }, or { id: null } when the
// scheme is one only Cinnamon can paint (Default, Glass). This mod passes that on and follows changes. The desktop app
// copies local plugins to the SSH hosts its Code sessions run on, so the look travels with the mod there. While the app paints a mod theme it marks the page (data-cds-theme="mod-palette"), and Cinnamon's own
// colours step aside there, so the two never fight.
//
// Installed by `cinnamon install` into ~/.claude/skills/cinnamon-colors (a plugin there loads in every session) and
// removed by `cinnamon uninstall`. Where nothing draws themes (the terminal, VS Code, a host without Cinnamon's
// files) it does nothing visible.

const EVERY_MS = 2000;

let shown = null; // the look id the app drew for this session
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
  const look = await readLook($);
  if (look === undefined) return;
  const id = look && typeof look.id === 'string' && look.colors ? look.id : null;
  if (id) {
    if (id === shown) return;
    const set = await $.theme.set({ colors: look.colors });
    if (set.isDrawn === true) {
      shown = id;
      await $.store.set('painted', id);
    }
    return;
  }
  // The person picked a scheme only Cinnamon paints. The app keeps a mod theme until it is cleared, so clear the one
  // this mod set (in this session or an earlier one), and never another mod's.
  shown = null;
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
};
