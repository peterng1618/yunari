/**
 * Registers the display's own service worker, which is what makes the player
 * installable and its shell available offline.
 *
 * **Failure is reported and swallowed.** The display is a wall screen, and a
 * browser that refuses the registration — an insecure origin, a policy, a
 * worker that would not install — must still show the theme it was pointed at.
 * A registration that took the display down would turn "no offline shell" into
 * "no display", which is a worse trade than the one being made.
 *
 * The script is at the host's root, so its scope is `/` and the player's own
 * document is inside it. `/sw.js` is on the host's bundle-asset allowlist
 * because the browser fetches it without a session.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
    console.warn(
      "Yunari: the display could not register its service worker.",
      error,
    );
  });
}
