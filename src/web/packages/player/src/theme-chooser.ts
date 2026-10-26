import { type ChromeSide, putStrip } from "./chrome.js";
import type { DisplaySessionToken } from "./session.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The control a paired display uses to choose its own theme.
 *
 * The host already follows an assignment made from this PC; this is the same
 * act from the screen instead of the admin page. **The credential is the
 * authority**: a paired session writes `{ id }` and nothing else, because the
 * display is the one its token names, and a body carrying a `display` key
 * would be a client naming someone else's screen. A reader with no credential
 * in any form gets no control at all — being shown one that could only refuse
 * is worse than being shown none. The token is not always readable: after
 * pairing it lives in an HttpOnly cookie, so the mount owner says
 * `paired: true` for a page whose token the URL and storage do not carry.
 *
 * The chooser is a strip in a chrome band rather than a floating control: it
 * is persistent and takes its room from the artboard the way `chrome.ts`
 * describes. It is mounted only for a page the host resolved itself
 * (`theme-source=map`): a link or a published page names a theme the person
 * meant, and `reResolveUrl` keeps that id, so a chooser there could not
 * deliver what it offered.
 *
 * A chosen theme is shown the way an assigned one is — the page navigates to
 * its own URL with the resolution run again (`publish-follower.ts`'s
 * `reResolveUrl`) — so there is one path from "the host says this display
 * shows X" to the screen, and `onChosen` is where the player takes it.
 */

export interface ThemeChoice {
  readonly id: string;
  readonly name: string;
}

export interface ThemeChooserOptions {
  readonly session: DisplaySessionToken;
  readonly side: ChromeSide;
  /** The theme on screen now, kept selected until the page navigates. */
  readonly current: string;
  readonly onChosen: (id: string) => void;
  /** The host's own words for a refusal. Absent means the reader is not told,
   *  which a caller that cannot show a notice may choose. */
  readonly onError?: (message: string) => void;
  /** Whether this display holds a credential in any form. Defaults to a
   *  readable token; a cookie-paired page passes `true`, because its token is
   *  HttpOnly and the player is the one that knows the page is paired. */
  readonly paired?: boolean;
}

const STRIP_ID = "yunari-theme-chooser";

/** The host's refusal text when there is one, because it says which refusal
 *  this was; the fallback only covers an empty body. */
async function hostWords(
  response: Response,
  fallback: string,
): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.length > 0 ? text : fallback;
}

function choiceOf(entry: unknown): ThemeChoice {
  const value = entry as { readonly id?: unknown; readonly name?: unknown };
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string"
  ) {
    // A library this display cannot read is refused, not coerced into a list
    // of blanks: the select would otherwise offer themes that cannot be named.
    throw new Error(uiCopy.chooser.listFailed);
  }
  return { id: value.id, name: value.name };
}

/** The host's library, as the two fields a chooser needs and no more. */
export async function listLocalThemes(
  session: DisplaySessionToken,
): Promise<readonly ThemeChoice[]> {
  const response = await session.fetch("/api/themes");

  if (!response.ok) {
    throw new Error(await hostWords(response, uiCopy.chooser.listFailed));
  }

  const body = (await response.json()) as { readonly themes?: unknown };

  if (!Array.isArray(body.themes)) {
    throw new Error(uiCopy.chooser.listFailed);
  }

  return body.themes.map(choiceOf);
}

/** Writes this display's own choice. The display is the credential's. */
export async function chooseOwnTheme(
  session: DisplaySessionToken,
  id: string,
): Promise<void> {
  if (id.length === 0) {
    throw new Error(uiCopy.chooser.idRequired);
  }

  const response = await session.fetch("/api/themes/active", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    // `{ id }` and nothing else: see the module comment.
    body: JSON.stringify({ id }),
  });

  if (!response.ok) {
    throw new Error(await hostWords(response, uiCopy.chooser.chooseFailed));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createThemeChooser(input: ThemeChooserOptions): {
  readonly dispose: () => void;
} {
  // Nothing is asked of the host either: a list this reader cannot act on is a
  // request the display should not make.
  if (!(input.paired ?? input.session.token !== undefined)) {
    return { dispose: () => {} };
  }

  const label = document.createElement("label");
  label.textContent = `${uiCopy.chooser.label} `;

  const select = document.createElement("select");
  select.dataset["yunariThemeSelect"] = "";
  select.setAttribute("aria-label", uiCopy.chooser.label);
  label.append(select);

  // Through the chrome's own construction, so the safe-area inset, the font
  // and the strip marker are one owner rather than a second copy of them.
  const strip = putStrip({
    side: input.side,
    id: STRIP_ID,
    children: [label],
    background: "#14161c",
    color: "#e8ecf3",
  });
  strip.dataset["yunariThemeChooser"] = "";

  let disposed = false;

  function dispose(): void {
    disposed = true;
    strip.remove();
  }

  select.addEventListener("change", () => {
    const id = select.value;
    if (id.length === 0) return;

    void chooseOwnTheme(input.session, id).then(
      () => {
        if (!disposed) input.onChosen(id);
      },
      (error: unknown) => {
        if (disposed) return;
        // The display still shows `current`, so putting the choice back is
        // telling the reader the write did not happen.
        select.value = input.current;
        input.onError?.(messageOf(error));
      },
    );
  });

  void listLocalThemes(input.session).then(
    (themes) => {
      if (disposed) return;
      for (const theme of themes) {
        const option = document.createElement("option");
        option.value = theme.id;
        option.textContent = theme.name;
        select.append(option);
      }
      select.value = input.current;
    },
    (error: unknown) => {
      if (disposed) return;
      input.onError?.(messageOf(error));
      // A list that did not arrive leaves nothing to choose, and a strip that
      // could only refuse is the thing this control must never be.
      dispose();
    },
  );

  return { dispose };
}
