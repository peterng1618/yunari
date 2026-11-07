/**
 * The one place a view preference is kept for the browser tab's session.
 *
 * A sort, a filter or the tab a pane was browsing is a fact about this sitting,
 * never authored state: it must not reach a theme document and must not greet a
 * person a week later. `sessionStorage` is exactly that lifetime, and a browser
 * that refuses it (a private window, a blocked context) leaves the surface's
 * own state as the only record — a preference is not an error to render.
 */
export function readSessionView(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionView(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // No store: the choice lives as long as the component that holds it.
  }
}
