// Cinnamon page runtime: the small API every extension's page code gets as `cinnamon`. Runs in the claude.ai page
// before any extension. Messages go to the main process as console messages prefixed "[cinnamon] ".
//   cinnamon.send(type, data)           → the extension's main part (bundled extensions) receives it
//   cinnamon.settings.get(key) / .set(key, value) / .all() / .onChange(fn)
//                                        → per-extension settings, saved in ~/.config/claude-cinnamon/config.json
(() => {
  const C = (window.__cinnamon ??= { settings: {}, listeners: {} });
  C.settings ??= {};
  C.listeners ??= {};

  C.send = (msg) => { try { console.debug(`[cinnamon] ${JSON.stringify(msg)}`); } catch {} };

  const notify = (id) => {
    for (const fn of C.listeners[id] || []) { try { fn({ ...(C.settings[id] || {}) }); } catch {} }
  };

  C.setSettings = (all) => {
    C.settings = all && typeof all === 'object' ? all : {};
    for (const id of Object.keys(C.listeners)) notify(id);
  };

  C.reset = (id) => { C.listeners[id] = []; };

  C.api = (id) => ({
    id,
    send: (msg, data) => C.send({ type: 'ext', ext: id, msg, data }),
    settings: {
      get: (key) => (C.settings[id] || {})[key],
      all: () => ({ ...(C.settings[id] || {}) }),
      set: (key, value) => {
        (C.settings[id] ??= {})[key] = value;
        C.send({ type: 'ext-setting', ext: id, key, value });
        notify(id);
      },
      onChange: (fn) => { if (typeof fn === 'function') (C.listeners[id] ??= []).push(fn); },
    },
  });
})();
