// Builds the main-process script core/apply.sh evaluates: the template with its paths filled in.
// The main process reads extensions, themes and the core page code itself, so they can change without re-rendering.
// CLI: node core/render.cjs <cinnamon dir>
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Where the user's own config, themes, extensions and data live (kept apart from the tool's code).
const USER_DIR = process.env.CINNAMON_HOME || path.join(os.homedir(), '.config', 'claude-cinnamon');

function renderMain({ template, root, userDir = USER_DIR, themeDirs = null, extRoots = null }) {
  const subs = { __ROOT__: root, __USER_DIR__: userDir, __THEME_DIRS__: themeDirs, __EXT_ROOTS__: extRoots };
  let out = template;
  for (const [k, v] of Object.entries(subs)) out = out.replaceAll(k, () => JSON.stringify(v));
  return out;
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  process.stdout.write(renderMain({ template: fs.readFileSync(path.join(root, 'core', 'main.js.tmpl'), 'utf8'), root }));
}

module.exports = { renderMain, USER_DIR };
