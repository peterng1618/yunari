/**
 * The host's editor mount, with its shell mode named.
 *
 * `parseShellEntry` (`editor-shell/shell-entry.ts`) takes `editor`, `themes` or
 * `settings`, and defaults to **themes** when `mode` is missing or invalid. A
 * spec that navigates to a bare `/editor/` and then looks for the canvas is
 * therefore reading the store: the canvas is a 1×1 hidden element behind it.
 *
 * Built through `URL` so a second parameter appends: `?mode=editor?theme=…`
 * parses as neither, and the document is silently not opened.
 */
export function hostEditorUrl(
  host: string,
  options: { mode?: "editor" | "settings"; themeId?: string } = {},
): string {
  const url = new URL("/editor/", host);
  url.searchParams.set("mode", options.mode ?? "editor");
  if (options.themeId !== undefined) {
    url.searchParams.set("theme", options.themeId);
  }
  return url.toString();
}
