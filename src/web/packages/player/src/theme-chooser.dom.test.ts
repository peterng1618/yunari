// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { putStrip } from "./chrome.js";
import { type DisplaySessionToken, displaySession } from "./session.js";
import {
  chooseOwnTheme,
  createThemeChooser,
  listLocalThemes,
  type ThemeChoice,
} from "./theme-chooser.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The display's own chooser: the one control a reader at a paired screen has
 * for changing what that screen shows.
 *
 * What is pinned here is the request and the refusal, not the rendering: the
 * body is the whole authority question (the display is the credential's, so a
 * `display` key would be a client naming someone else's screen), and a
 * session-less reader is offered nothing rather than a control that can only
 * refuse. Browser geometry is the e2e proof's, not this file's.
 */

const CHOOSER = "[data-yunari-theme-chooser]";
const SELECT = "[data-yunari-theme-select]";

function skeleton(): void {
  document.body.replaceChildren();
  for (const side of ["top", "bottom"] as const) {
    const band = document.createElement("div");
    band.id = `yunari-chrome-${side}`;
    band.dataset["yunariChrome"] = side;
    document.body.append(band);
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function paired(fetcher: Fetcher, token = "paired-token"): DisplaySessionToken {
  return displaySession(
    `http://yunari.invalid/?session=${token}`,
    fetcher as typeof fetch,
  );
}

function unpaired(fetcher: Fetcher): DisplaySessionToken {
  return displaySession("http://yunari.invalid/", fetcher as typeof fetch);
}

const THEMES: readonly ThemeChoice[] = [
  { id: "living-room", name: "Living Room" },
  { id: "kitchen-strip", name: "Kitchen Strip" },
];

function select(): HTMLSelectElement {
  return document.querySelector<HTMLSelectElement>(SELECT) as HTMLSelectElement;
}

beforeEach(skeleton);

describe("choosing a theme for this display", () => {
  it("writes the theme and names no display", async () => {
    // The display is the one the credential names. A `display` key in the body
    // is a client trying to name someone else's screen, so the body is read
    // back as a whole object rather than by its `id` field alone.
    const fetcher = vi.fn<Fetcher>(async () => json({}));
    const session = paired(fetcher);

    await chooseOwnTheme(session, "kitchen-strip");

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(input).toBe("/api/themes/active");
    expect(init?.method).toBe("PUT");

    const body: unknown = JSON.parse(String(init?.body));
    expect(body).toEqual({ id: "kitchen-strip" });
    expect(Object.keys(body as object)).toEqual(["id"]);

    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-yunari-session")).toBe("paired-token");
  });

  it("does not offer a chooser to a session-less reader", async () => {
    // A reader who cannot write must not be shown a control that would only
    // refuse, and the control must not ask the host for a list it cannot use.
    const fetcher = vi.fn<Fetcher>(async () => json({ themes: [] }));
    const chooser = createThemeChooser({
      session: unpaired(fetcher),
      side: "bottom",
      current: "living-room",
      onChosen: () => {
        throw new Error("a session-less reader must not reach onChosen");
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector(CHOOSER)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    chooser.dispose();
  });

  it("offers a chooser on a cookie-paired page, whose token cannot be read", async () => {
    // The player passes `paired` for a page whose credential is the same-origin
    // HttpOnly cookie: the token is deliberately unreadable, but the display is
    // paired and its own-theme write is allowed.
    const fetcher = vi.fn<Fetcher>(async () => json({ themes: THEMES }));

    const chooser = createThemeChooser({
      session: unpaired(fetcher),
      paired: true,
      side: "bottom",
      current: "living-room",
      onChosen: () => undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector(CHOOSER)).not.toBeNull();
    expect(fetcher).toHaveBeenCalled();
    chooser.dispose();
  });

  it("reports the host's refusal in the host's own words", async () => {
    const refusal = "This display is not paired with the host.";
    const fetcher = vi.fn<Fetcher>(async (_input, init) => {
      if (init?.method === "PUT") {
        return new Response(refusal, { status: 403 });
      }
      return json({ themes: THEMES });
    });
    const onError = vi.fn();
    const onChosen = vi.fn();
    createThemeChooser({
      session: paired(fetcher),
      side: "bottom",
      current: "living-room",
      onChosen,
      onError,
    });

    await vi.waitFor(() => expect(select().options).toHaveLength(2));
    select().value = "kitchen-strip";
    select().dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(refusal));
    expect(onChosen).not.toHaveBeenCalled();
  });

  it("lists the host's themes with their names", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      json({ themes: THEMES, templates: [] }),
    );
    const session = paired(fetcher);

    const choices = await listLocalThemes(session);

    expect(choices).toEqual(THEMES);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/themes");
    expect(
      new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("x-yunari-session"),
    ).toBe("paired-token");
  });

  it("offers the library and hands the chosen id up", async () => {
    const fetcher = vi.fn<Fetcher>(async (_input, init) => {
      if (init?.method === "PUT") return json({});
      return json({ themes: THEMES });
    });
    const onChosen = vi.fn();
    createThemeChooser({
      session: paired(fetcher),
      side: "bottom",
      current: "living-room",
      onChosen,
    });

    await vi.waitFor(() => expect(select().options).toHaveLength(2));
    expect(select().value).toBe("living-room");

    select().value = "kitchen-strip";
    select().dispatchEvent(new Event("change"));

    await vi.waitFor(() =>
      expect(onChosen).toHaveBeenCalledWith("kitchen-strip"),
    );
  });

  it("refuses an empty id without asking the host", async () => {
    const fetcher = vi.fn<Fetcher>(async () => json({}));

    await expect(chooseOwnTheme(paired(fetcher), "")).rejects.toThrow(
      uiCopy.chooser.idRequired,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("builds its strip through the chrome, inset and font included", async () => {
    // `index.html` sets `viewport-fit=cover`, so the strip's own inset is what
    // keeps a persistent control out of a notched phone's home indicator; a
    // hand-written padding is how that inset goes missing.
    const fetcher = vi.fn<Fetcher>(async () => json({ themes: THEMES }));
    createThemeChooser({
      session: paired(fetcher),
      side: "bottom",
      current: "living-room",
      onChosen: vi.fn(),
    });
    await vi.waitFor(() => expect(select().options).toHaveLength(2));

    const reference = putStrip({
      side: "bottom",
      id: "yunari-reference-strip",
      text: "x",
      background: "#14161c",
      color: "#e8ecf3",
    });
    const strip = document.querySelector<HTMLElement>(CHOOSER) as HTMLElement;

    expect(strip.style.padding).toBe(reference.style.padding);
    // The inset's own token, not only that the two strips agree: a `stripInset`
    // that stopped emitting it would take both sides with it, and the comparison
    // above would still pass. `side: "bottom"` carries it in the shorthand's
    // bottom slot.
    expect(strip.style.padding).toContain("env(safe-area-inset-bottom)");
    expect(strip.style.font).toBe(reference.style.font);
    expect(strip.dataset["yunariChromeStrip"]).toBeDefined();
  });

  it("takes itself away when the library cannot be read", async () => {
    // An empty select is a control that could only refuse, which is the one
    // thing this control must never be.
    const fetcher = vi.fn<Fetcher>(
      async () => new Response("No list.", { status: 500 }),
    );
    const onError = vi.fn();
    createThemeChooser({
      session: paired(fetcher),
      side: "bottom",
      current: "living-room",
      onChosen: vi.fn(),
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("No list."));
    expect(document.querySelector(CHOOSER)).toBeNull();
  });
});
