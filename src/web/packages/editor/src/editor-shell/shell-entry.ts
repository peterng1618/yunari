import type { ShellMode } from "./shell-layout.js";

/**
 * Which surface the editor opens on, as the URL asks for it.
 *
 * The host's tray opens the editor's existing surfaces by opening a URL, so the
 * query is the only route in. `mode` names one of the two non-editor surfaces
 * and anything else is the editor; `publish` opens the publish surface, but
 * only where there is a document to publish — a store or host surface named in
 * the same URL wins over the flag rather than leaving a popover over a page
 * with no editor in it.
 */
export interface ShellEntry {
  readonly mode: ShellMode;
  readonly publish: boolean;
}

export function parseShellEntry(search: string): ShellEntry {
  const parameters = new URLSearchParams(search);
  const named = parameters.get("mode");
  const mode: ShellMode =
    named === "themes" || named === "this-pc" ? named : "editor";
  return {
    mode,
    publish: mode === "editor" && parameters.get("publish") === "1",
  };
}
