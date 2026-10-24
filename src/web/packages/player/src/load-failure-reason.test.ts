// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { showLoadFailure } from "./load-failure.js";
import { loadHostedTheme, ThemeLoadError } from "./theme-loader.js";

/**
 * The reason a display shows, for a cause the loader can actually hit.
 *
 * This runs the real chain — a fetch, the loader's throw, the page — rather
 * than a sentence pasted into the view, so it fails if the mapping is bypassed
 * again. It was bypassed once: `main.ts` passed `error.message` straight to
 * `loadFailureView`, and a phone pointed at a host that was not running showed
 * `Reason: Unexpected token '<', "<!doctype "... is not valid JSON` on a wall.
 * That text says the theme file is corrupt; nothing was serving at all.
 *
 * Revert `showLoadFailure` to `error.message` and the first test below fails.
 */

/** What a dev server or proxy answers a theme request with when no host is
 *  running: its own index page, HTML, at 200. */
const HOST_NOT_RUNNING = () =>
  new Response("<!doctype html>\n<html><body>Yunari</body></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** Runs the real load, and returns what reached the display. */
async function reasonShownFor(
  fetcher: typeof fetch,
  id = "does-not-exist",
): Promise<string> {
  document.body.replaceChildren();
  try {
    await loadHostedTheme(id, fetcher);
  } catch (error) {
    showLoadFailure(error);
  }
  return (
    document.body.querySelector<HTMLElement>(
      "[data-yunari-load-failure-reason]",
    )?.textContent ?? ""
  );
}

/** What V8 writes when HTML arrives where JSON was expected. */
const PARSER_TEXT = ["SyntaxError", "Unexpected token", "is not valid JSON"];

describe("the reason a display shows when the host does not answer with a theme", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.replaceChildren();
  });

  it("names what happened instead of the parser's complaint", async () => {
    const shown = await reasonShownFor(async () => HOST_NOT_RUNNING());

    // The measured defect, verbatim from the screen it came off.
    for (const text of PARSER_TEXT) {
      expect(shown, shown).not.toContain(text);
    }
    expect(shown).toContain("did not answer with a theme");
  });

  it("says the host may not be running, which is the likeliest cause", async () => {
    // An HTML page where a theme was expected has three causes — no host, a
    // proxy in front, a wrong address — and one of them is nearly all of them.
    const shown = await reasonShownFor(async () => HOST_NOT_RUNNING());

    expect(shown).toContain("may not be running");
  });

  it("keeps the page around it, so the fix is one line and not a redesign", async () => {
    // F1.14's page is right and stays right: the reader still has both ways on.
    const host = document.body;

    try {
      await loadHostedTheme("does-not-exist", async () => HOST_NOT_RUNNING());
    } catch (error) {
      showLoadFailure(error);
    }

    expect(host.querySelector("h1")?.textContent).toBe(
      "This display has nothing to show",
    );
    expect(
      host.querySelector("[data-yunari-load-failure-retry]"),
    ).not.toBeNull();
    expect(
      host.querySelector("[data-yunari-load-failure-host]"),
    ).not.toBeNull();
  });

  it("keeps the raw cause for a developer, out of the reader's sight", async () => {
    const warn = vi.spyOn(console, "warn");
    let thrown: unknown;
    try {
      await loadHostedTheme("does-not-exist", async () => HOST_NOT_RUNNING());
    } catch (error) {
      thrown = error;
    }

    const host = document.body;
    showLoadFailure(thrown);

    // The person fixing this is not looking at a phone, which is why the
    // detail was kept in the first place. It reaches them through the console
    // — where every other player diagnostic already goes — with the whole
    // error, not a string of it.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toBe(thrown);
    expect(host.textContent ?? "").not.toContain("SyntaxError");
  });
});

describe("every other cause the loader can reach", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.replaceChildren();
  });

  it("still says what it always said when the id is missing entirely", () => {
    // `main.ts` reaches this before any fetch. The sentence was already right;
    // moving it into the copy owner must not change a word of it.
    const host = document.body;
    showLoadFailure(new ThemeLoadError("missing-id", "No ?theme=."));

    expect(host.textContent).toContain("A theme id is required.");
  });

  it("distinguishes an unusable id from a missing one", async () => {
    const shown = await reasonShownFor(
      async () => new Response("", { status: 200 }),
      "../escape",
    );

    expect(shown).toContain("not one the host can be asked for");
  });

  it("names a theme the host does not have, with the status to quote", async () => {
    const shown = await reasonShownFor(
      async () => new Response("", { status: 404 }),
    );

    expect(shown).toContain("no theme with that id");
    expect(shown).toContain("404");
  });

  it("separates a broken host from a wrong id", async () => {
    const shown = await reasonShownFor(
      async () => new Response("", { status: 500 }),
    );

    expect(shown).toContain("could not produce that theme");
    expect(shown).toContain("500");
    expect(shown).not.toContain("no theme with that id");
  });

  it("names the validation when a theme arrives but does not validate", async () => {
    const shown = await reasonShownFor(async () =>
      Response.json({ schemaVersion: "3.0.0" }),
    );

    // The validator's codes are already a vocabulary, so the sentence carries
    // the code and the reader is sent to the author, not to a JSON parser.
    expect(shown).toContain("a theme this display cannot show");
    expect(shown).toContain("newer-schema-version");
    for (const text of PARSER_TEXT) {
      expect(shown, shown).not.toContain(text);
    }
  });

  it("says a sentence for a cause it does not recognise", async () => {
    const host = document.body;
    const cause = new TypeError("Cannot read properties of null (reading 'x')");

    showLoadFailure(cause);

    // Not silence, and not `String(error)`: a display that says nothing
    // actionable has failed at its job, and one that says "Cannot read
    // properties of null" has said it to the wrong person.
    expect(host.textContent).toContain("could not start");
    expect(host.textContent).not.toContain("null");
    expect(host.textContent).not.toContain("TypeError");
  });

  it("says a sentence for a thrown non-Error too", async () => {
    const host = document.body;

    showLoadFailure("just a string");

    expect(host.textContent).toContain("could not start");
    expect(host.textContent).not.toContain("just a string");
  });
});
