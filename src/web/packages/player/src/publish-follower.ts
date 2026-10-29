/**
 * Whether what this display is showing is still what the author is publishing,
 * and whether the theme it was assigned has moved.
 *
 * One small number, polled, because the display already holds an SSE connection
 * for readings and adding a second event channel would be a second owner for
 * "the host has news". A refusal is not silence: a session that expired turns
 * every poll into a 403, and a follower that read that as "nothing changed"
 * would leave a frozen dashboard with no explanation (Review Focus 4).
 *
 * The poll names the display it is for, read from the page it is on, and that
 * is what lets the host answer an assignment at all: the page carries the
 * display it was resolved for and where its theme came from, and neither is
 * inferable from `/api/published` alone. It is also the only *repeating*
 * request a local display's window makes, so it is the sighting that keeps a
 * restarted host from opening a second window on a monitor that has one.
 *
 * `ponytail:` comes back with the document rather than diffing it in place —
 * a flash on a phone that is usually on a wall, for one screenful of code. If
 * the flash ever matters, the upgrade is to hand the new envelope to the
 * existing mount instead of reloading.
 */

import type { DisplayPresentation, DisplayShape } from "@yunari/renderer-core";

interface PublishFollowerSession {
  readonly pageUrl: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface PublishFollowerOptions {
  readonly intervalMs?: number;
  readonly onRefused?: (reason: string) => void;
  /** The theme the host now says this display should be showing. Called only
   *  for a page the host resolved itself, and only when the answer moves. */
  readonly onThemeChange?: (theme: string | null) => void;
  /** The glass and mounting angle the host now says this display is. Reported
   *  only when the answer moves, including the first answer — a page that has
   *  just loaded is already wearing what the host last resolved, so the first
   *  answer is the baseline rather than news. A shape the host could not have
   *  stored, or an angle its own rule refuses, is ignored rather than defaulted:
   *  this is a guard against a payload, not a user path, and inventing `rect`/0
   *  here would move a round display the host never asked to move. */
  readonly onPresentationChange?: (next: {
    readonly shape: DisplayShape;
    readonly rotation: number;
  }) => void;
  /** The host did not answer this tick. Reported every time it does not — a
   *  fact, not a policy: how often the caller may act on it is the caller's
   *  business, because only the caller knows what it costs. Latching here was
   *  the first shape ruled and it strands a display (R72): the host moves, the
   *  one sweep misses while the host is still booting, and no tick can succeed
   *  while the host is at its old address, so the latch never clears. */
  readonly onUnreachable?: () => void;
}

const DEFAULT_INTERVAL_MS = 2_000;
/** Only the page's query is read, and `new URL` needs a base to read one from. */
const PAGE_BASE = "http://yunari.invalid";

/**
 * The page's own URL, with the resolution made to run again (R51).
 *
 * `GET /` skips its resolution entirely when the URL carries `data`, and its own
 * 302 sets `data=live` — so `location.reload()` re-requests the same URL and
 * re-serves **the same theme id**. A publish survives that, because it keeps the
 * id and changes the document; an assignment changes the id, which is the one
 * thing a reload cannot deliver. So `data` always goes.
 *
 * `theme` goes too, but **only for a page the host resolved itself**: that id is
 * the host's own answer and is the one that has to be re-asked, while a link
 * page's id is the person's instruction. A *published* page is the host's answer
 * too when it names a display: keeping the id there would pin the display to the
 * theme once published, so a later assignment could never move it. A published
 * page with no display is the person's preview and keeps its id. `display` and
 * `session` are never touched, so the display still names itself and the sighting
 * survives the reload.
 */
export function reResolveUrl(href: string): string {
  const page = new URL(href, PAGE_BASE);
  page.searchParams.delete("data");

  const source = page.searchParams.get("theme-source");
  const hostResolved =
    source === "map" ||
    (source === "published" && page.searchParams.get("display") !== null);

  if (hostResolved) {
    page.searchParams.delete("theme");
  }

  return page.href;
}

/**
 * The poll this page's own display answers.
 *
 * The page names the display it was resolved for and where its theme came from.
 * **The theme itself is forwarded only for a link**, because a theme the host
 * resolved is answered by the map: a page that echoed its own back would be
 * answered `null` — the link rule — on every poll, and no assignment would ever
 * reach anyone.
 */
function pollUrl(page: URL): string {
  const query = new URLSearchParams();
  const display = page.searchParams.get("display");
  const source = page.searchParams.get("theme-source");
  const theme = page.searchParams.get("theme");

  if (display !== null) query.set("display", display);
  if (source !== null) query.set("theme-source", source);
  if (source === "link" && theme !== null) query.set("theme", theme);

  const search = query.toString();

  return search.length === 0 ? "/api/published" : `/api/published?${search}`;
}

export function followPublished(
  session: PublishFollowerSession,
  reload: () => void,
  options: PublishFollowerOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const page = new URL(session.pageUrl, PAGE_BASE);
  const url = pollUrl(page);
  // Only a page the host resolved itself may be moved by an assignment. A link
  // is the person's own instruction for that page, and a page showing a publish
  // would reload, re-resolve to the published theme and see the map's entry
  // again on the next poll — a reload loop. Suppressing costs nothing, because
  // the revision comparison below reloads a display when the publish moves.
  const followsMap = page.searchParams.get("theme-source") === "map";
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: number | undefined;
  let lastTheme: string | null | undefined;
  let lastPresentation: DisplayPresentation | undefined;
  /** The theme in this page's own URL, and the theme last published. A publish
   *  of another theme moves the revision too, and this page has nothing to
   *  reload for: one author's working document must not restart another
   *  display (2026-10-29). */
  const pageTheme = page.searchParams.get("theme");
  let lastPublished: string | null | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;

    try {
      const response = await session.fetch(url);

      if (response.status === 403 || response.status === 404) {
        stopped = true;
        options.onRefused?.("This display is no longer paired with the host.");
        return;
      }

      if (response.ok) {
        const body = (await response.json()) as {
          revision?: unknown;
          id?: unknown;
          display?: {
            theme?: unknown;
            shape?: unknown;
            rotation?: unknown;
          };
        };

        // The glass is reported ahead of the two reloads: it is a fact about
        // this display, and the reload a publish move triggers is a new page
        // that will report it again anyway.
        const shape = body.display?.shape;
        const rotation = body.display?.rotation;

        if (
          (shape === "rect" || shape === "circle") &&
          typeof rotation === "number" &&
          Number.isInteger(rotation) &&
          rotation >= 0 &&
          rotation < 360 &&
          (shape === "circle" || rotation % 90 === 0)
        ) {
          if (
            lastPresentation === undefined ||
            lastPresentation.shape !== shape ||
            lastPresentation.rotation !== rotation
          ) {
            lastPresentation = { shape, rotation };
            options.onPresentationChange?.({ shape, rotation });
          }
        }

        const published =
          body.id === null || typeof body.id === "string" ? body.id : undefined;
        const wasPublished = lastPublished;
        lastPublished = published;
        // A publish of this page's theme is news; so is one clearing it, which
        // is the page dropping the overlay. Anything else leaves the page be.
        const concernsThisPage =
          published === pageTheme ||
          (published === null && wasPublished === pageTheme);

        if (typeof body.revision === "number") {
          // `last` moves even on the reload path. Reloading and returning with
          // `last` still stale re-fires on every tick, which is invisible in
          // production (a real reload navigates away) and a reload storm the
          // moment the reload does not — a test double, or a blocked reload.
          const moved = last !== undefined && body.revision !== last;
          last = body.revision;
          if (moved && concernsThisPage) {
            reload();
            return;
          }
        }

        const theme = body.display?.theme;

        if (theme === null || typeof theme === "string") {
          // The first answer is the baseline: a page that has just loaded is
          // showing what the host last resolved for it, so only a *move* is
          // news. `lastTheme` moves before the reload for the reason `last`
          // does.
          const moved = lastTheme !== undefined && theme !== lastTheme;
          lastTheme = theme;
          if (moved && followsMap) {
            // The callback is the reload when there is one — it is what
            // navigates to `reResolveUrl`, and reloading after it would
            // re-request the URL that navigation just left.
            if (options.onThemeChange) {
              options.onThemeChange(theme);
            } else {
              reload();
            }
            return;
          }
        }
      }
    } catch {
      // A host that is briefly unreachable is the connection surface's news,
      // not this follower's: the readings stream already says it. It is also
      // the only sighting of an unreachable host anything has, so the caller is
      // told — every tick, because the caller is the one that knows what acting
      // on it costs.
      options.onUnreachable?.();
    } finally {
      // Armed by the settle, not on a fixed schedule: an interval keeps firing
      // while a slow host still owes the last answer, stacking polls, and it
      // keeps firing once a refusal has stopped anything from using them.
      if (!stopped) {
        timer = setTimeout(() => void tick(), intervalMs);
      }
    }
  };

  void tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
