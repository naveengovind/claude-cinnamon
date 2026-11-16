// Types for make-colors.js, the design system's theme builder that Claude Code ships in its plugin-authoring skill
// (copied unchanged from Claude Code 2.1.325). Written here without the `claude-code` types the original imports.
type Hex = string;
type Role = Hex | { seed?: Hex; stops?: Record<number, Hex>; fillShade?: number };
export type Roles = Partial<Record<'accent' | 'danger' | 'success' | 'warning' | 'pro', Role>>;
export type Anchors = { 'surface-0': Hex; 'text-primary': Hex } & Partial<
  Record<'surface-1' | 'surface-2' | 'surface-3' | 'text-secondary' | 'text-muted', Hex>
>;
export type Mode = {
  gray?: { anchors?: Anchors; stops?: Record<number, Hex> };
  roles?: Roles;
  git?: Partial<Record<'added' | 'removed' | 'modified' | 'merged' | 'closed' | 'conflicting' | 'draft', Hex>>;
};
export interface MakeColorsDefinition {
  label: string;
  id?: string;
  roles?: Roles;
  light?: Mode;
  dark?: Mode;
  codeTheme?: { light?: string; dark?: string };
  contrast?: 'more';
  only?: 'light' | 'dark';
}
/** A whole theme from a few colors, and what fails. Throws on a color it can't use. */
export function makeColors(definition: MakeColorsDefinition): { theme: unknown; problems: string[] };
/** What's wrong with a theme from anywhere, as plain lines. */
export function checkColors(colors: unknown): string[];
