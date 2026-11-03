/**
 * The player page a hardware panel renders. `?display=` names the record whose
 * theme and presentation it shows; `panel=1` tells the player it is a still
 * panel rather than a browser, which is what lets an unmarked glass panel
 * sample the declared still instead of the live frames the panel never sees.
 *
 * `clip=1` says the device decodes the theme clip itself. The page then stands
 * on one poster frame instead of loading the source; without it the device
 * shows the page's frames, so the page loads a clip scaled to the panel.
 *
 * `themeId` renders a theme the display is not assigned, which is what a
 * preview asks for.
 */
export function panelPageUrl(
  port: number,
  displayId: string,
  clip = false,
  themeId?: string,
): string {
  const url = `http://127.0.0.1:${port}/?display=${encodeURIComponent(displayId)}&panel=1`;
  const withClip = clip ? `${url}&clip=1` : url;
  return themeId === undefined
    ? withClip
    : `${withClip}&theme=${encodeURIComponent(themeId)}`;
}

/**
 * The player page a library picture is rendered from.
 *
 * A theme id is the whole request: the picture is the artboard, not a display's
 * presentation, and the host's own player is the renderer the theme will be
 * shown in.
 */
export function themePageUrl(port: number, themeId: string): string {
  return `http://127.0.0.1:${port}/?theme=${encodeURIComponent(themeId)}`;
}
