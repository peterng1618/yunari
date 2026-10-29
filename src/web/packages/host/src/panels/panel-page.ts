/**
 * The player page a hardware panel renders. `?display=` names the record whose
 * theme and presentation it shows; `panel=1` tells the player it is a still
 * panel rather than a browser, which is what lets an unmarked glass panel
 * sample the declared still instead of the live frames the panel never sees.
 */
export function panelPageUrl(port: number, displayId: string): string {
  return `http://127.0.0.1:${port}/?display=${encodeURIComponent(displayId)}&panel=1`;
}
