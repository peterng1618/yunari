/** Shell chrome palettes. Browser-local only: never serialized into a theme
 * envelope, never authored document state. */
export const shellPalettes = [
  "editorial",
  "graphite",
  "ember",
  "moss",
  "plum",
  "light",
] as const;

export type ShellPalette = (typeof shellPalettes)[number];

/** The graphite look is the shell's default. */
export const DEFAULT_SHELL_PALETTE: ShellPalette = "graphite";

const storageKey = "yunari.editor.shell-palette";

function isShellPalette(value: string | null): value is ShellPalette {
  return value !== null && shellPalettes.includes(value as ShellPalette);
}

/** The palette an OS reporting `prefersDark` gets when the author has not chosen.
 *
 *  Both branches name a palette the picker already offers, so the OS asks for
 *  one of the six rather than a look of its own. The dark branch is the shell's
 *  default; the light branch is `light` and not `DEFAULT_SHELL_PALETTE`, because
 *  a light-reporting OS must open on the light surface rather than the dark one
 *  that is now the default. */
export function systemShellPalette(prefersDark: boolean): ShellPalette {
  return prefersDark ? DEFAULT_SHELL_PALETTE : "light";
}

/** The palette in force: the author's choice, or what the OS asks for.
 *
 *  One rule, and it is the whole of the "the palette picker as an explicit
 *  override": a choice is never overridden by the OS. */
export function resolveShellPalette(
  choice: ShellPalette | undefined,
  prefersDark: boolean,
): ShellPalette {
  return choice ?? systemShellPalette(prefersDark);
}

/** What the author chose, or `undefined` while the shell is following the OS.
 *
 *  `undefined` rather than the default, because the two are different states:
 *  the shell re-resolves on an OS change only while this is `undefined`. */
export function readShellChoice(storage: Storage): ShellPalette | undefined {
  const stored = storage.getItem(storageKey);
  return isShellPalette(stored) ? stored : undefined;
}

export function writeShellChoice(
  storage: Storage,
  palette: ShellPalette,
): void {
  storage.setItem(storageKey, palette);
}

/** Removes the author's choice, which is what hands the palette back to the OS.
 *
 *  `readShellChoice` already distinguishes "no choice" (`undefined`, the OS may
 *  speak) from a stored value, and until now nothing could reach that state — a
 *  choice was only ever replaced by another one. Deleting the key is the whole
 *  of "follow the system again", and the state the reader needs no new spelling
 *  for. */
export function clearShellChoice(storage: Storage): void {
  storage.removeItem(storageKey);
}

/** The OS preference, as a boolean. `matchMedia` is absent in jsdom and in any
 *  non-browser host, and an absent API is not a preference for dark. */
export function prefersDarkAppearance(): boolean {
  return (
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true
  );
}

/** Calls back when the OS appearance changes, until the returned function is
 *  called. `change` rather than the deprecated `addListener`. */
export function watchSystemAppearance(
  onChange: (prefersDark: boolean) => void,
): () => void {
  const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  if (query === undefined) return () => {};
  const listener = (event: MediaQueryListEvent): void =>
    onChange(event.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** The palette is written to `document.documentElement` and nowhere else.
 *
 * Base UI portals every popup, popover, tooltip and dialog to `document.body`,
 * which is a sibling of the editor's `#app` rather than a descendant, so an
 * attribute on `#app` is invisible to all of them and they repaint with the
 * bare `:root` defaults no matter which palette is in force. The document
 * element is the one node every one of those surfaces descends from, and it is
 * also what `:root` selects, so one attribute reaches the chrome and its
 * portalled surfaces together.
 *
 * There is deliberately no element parameter: every caller passed a subtree,
 * which is the mistake this signature exists to make impossible. */
export function applyShellPalette(palette: ShellPalette): void {
  document.documentElement.dataset["shellPalette"] = palette;
}
