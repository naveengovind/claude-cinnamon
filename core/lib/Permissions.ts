// Which macOS permissions Cinnamon uses, from config.json:
//   "permissions": "accessibility" (default) — Cinnamon Helper turns Claude's debugger on by itself each time Claude
//                                             starts, through Claude's Developer menu (needs Accessibility)
//                  "none"                   — no permission at all: you choose Developer → Enable Main Process Debugger
//                                             in Claude when it starts, and Cinnamon applies itself then
//   "closeChromeTab": false                 — leave the chrome://inspect tab Claude opens in Google Chrome (by
//                                             default Cinnamon Helper closes it, with Accessibility; no other permission)
import type { JsonObject } from './Config';

export type PermissionMode = 'accessibility' | 'none';
export interface PermissionPrefs { mode: PermissionMode; closeChromeTab: boolean }

export const PERMISSION_MODES: readonly PermissionMode[] = ['accessibility', 'none'];

export function permissionPrefs(cfg: JsonObject): PermissionPrefs {
  return { mode: cfg.permissions === 'none' ? 'none' : 'accessibility', closeChromeTab: cfg.closeChromeTab !== false };
}
