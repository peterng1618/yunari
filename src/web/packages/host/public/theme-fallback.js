/**
 * The theme a display shows: its own choice, else the default's.
 *
 * One rule, imported by the host's `assignedThemeFor` and by the chooser's
 * React entry (`src/admin/chooser.tsx`). The alternative — each side spelling
 * it — is two answers to "what is this display showing" that agree only until
 * one of them changes.
 *
 * Imported by the server bundle from source and bundled into the admin
 * chooser, so it carries no TypeScript, no DOM and no imports.
 */

/**
 * `own` is the display's own choice and `defaultTheme` the default's;
 * `undefined` or `null` mean none. A display that is the default passes its
 * choice as both, so it cannot fall back past itself.
 *
 * @param {string | null | undefined} own
 * @param {string | null | undefined} defaultTheme
 * @returns {string | undefined}
 */
export function themeForDisplay(own, defaultTheme) {
  return own ?? defaultTheme ?? undefined;
}
