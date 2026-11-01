import {
  EDITOR_THEME_TOKENS,
  type EditorThemeToken,
  type EditorThemeTokens,
  themeIdFromName,
} from "@yunari/theme-package";

/**
 * The palette source each role alias resolves from. The palette blocks write
 * both layers, so a theme applied to the document element must too: a role
 * write alone would move the React surfaces that consume roles and leave every
 * rule reading `--shell-*` on the palette underneath.
 *
 * `--stage`, `--hdr`, `--edge-2`, `--faint` and `--yunari-control-bg` have no
 * source of their own and are written as the roles they are. Where two roles
 * share a source — `--bg`/`--stage`, `--panel`/`--hdr` — the first in the map
 * writes it; a package authored from a palette carries equal values for the
 * pair, and a hand-edited pair keeps its diverging role values beside the one
 * source value a `--shell-*` consumer can hold.
 */
const SHELL_SOURCE: Partial<Record<EditorThemeToken, string>> = {
  "--bg": "--shell-backdrop",
  "--panel": "--shell-surface",
  "--panel-2": "--shell-surface-strong",
  "--edge": "--shell-edge",
  "--text": "--shell-text",
  "--muted": "--shell-muted",
  "--accent": "--shell-accent",
  "--attention": "--shell-attention",
  "--warn": "--shell-warm",
  "--hot": "--shell-danger",
};

const SOURCES = [...new Set(Object.values(SHELL_SOURCE))];

/** Writes a token set the way a palette block does: the roles and the palette
 *  sources they alias. The document element is the root because Base UI portals
 *  every popup out of the editor's own subtree. */
export function applyEditorThemeTokens(
  tokens: EditorThemeTokens,
  root: HTMLElement = document.documentElement,
): void {
  for (const token of EDITOR_THEME_TOKENS)
    root.style.setProperty(token, tokens[token]);
  for (const [token, source] of Object.entries(SHELL_SOURCE))
    if (source !== undefined)
      root.style.setProperty(source, tokens[token as EditorThemeToken]);
}

/** Removes both layers a theme wrote, which is how the palette in force becomes
 *  visible again. */
export function clearEditorTheme(
  root: HTMLElement = document.documentElement,
): void {
  for (const token of [...EDITOR_THEME_TOKENS, ...SOURCES])
    root.style.removeProperty(token);
}

export type ShellTokenRead =
  | { readonly ok: true; readonly tokens: EditorThemeTokens }
  | { readonly ok: false; readonly message: string };

/**
 * The tokens in force: an applied theme's inline properties first, then the
 * palette's resolved values. Reading the computed value is what makes "the
 * current shell palette plus overrides" one capture rather than two owners.
 * A token the shell does not declare is refused by name; an empty map saved as
 * a theme would be a package that paints nothing.
 */
export function readShellThemeTokens(
  root: HTMLElement = document.documentElement,
): ShellTokenRead {
  const computed = globalThis.getComputedStyle?.(root);
  const tokens: Record<string, string> = {};
  for (const token of EDITOR_THEME_TOKENS) {
    const value =
      root.style.getPropertyValue(token).trim() ||
      computed?.getPropertyValue(token).trim() ||
      "";
    if (value === "")
      return {
        ok: false,
        message: `The shell palette does not declare ${token}.`,
      };
    tokens[token] = value;
  }
  return { ok: true, tokens: tokens as EditorThemeTokens };
}

/** A package file named after the theme, with the library's id shape. */
export function editorThemeFileName(name: string): string {
  const base = themeIdFromName(name);
  return `${base === "" ? "editor-theme" : base}.yunari-theme`;
}
