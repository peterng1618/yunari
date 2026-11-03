import type { ShellMode } from "./shell-layout.js";

/**
 * Which surface the editor opens on, as the URL asks for it.
 *
 * The host's tray opens the editor's existing surfaces by opening a URL, so the
 * query is the only route in. `mode` names one of the three surfaces; a URL that
 * names none, or names something this build does not know, opens **Themes** —
 * a session starts from the store rather than from a blank document. `publish`
 * opens the publish surface, and it implies the editor because that is the only
 * surface with a document to publish; a named `themes` or `settings` still wins
 * over the flag rather than leaving a popover over a surface with no editor in
 * it.
 */
export interface ShellEntry {
  readonly mode: ShellMode;
  readonly publish: boolean;
}

export function parseShellEntry(search: string): ShellEntry {
  const parameters = new URLSearchParams(search);
  const named = parameters.get("mode");
  const wantsPublish = parameters.get("publish") === "1";
  const mode: ShellMode =
    named === "editor" || named === "themes" || named === "settings"
      ? named
      : wantsPublish
        ? "editor"
        : "themes";
  return {
    mode,
    publish: mode === "editor" && wantsPublish,
  };
}
