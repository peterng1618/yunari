// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAIRING_STORAGE_KEY } from "../../player/src/host-refind.js";

/**
 * `/pair.html`'s exchange, and what it leaves behind in storage.
 *
 * A display retired and re-paired at the same origin still holds the token it
 * stored the first time. The exchange sets a fresh cookie the page cannot read,
 * so a record left in storage is the *old* credential, and the player offers it
 * as its fallback on the next load. Clearing it is what stops a re-pair leaving
 * the previous token to be sent again.
 *
 * The page is a static document the host serves as-is — no build step and
 * nothing to import — so this reads the file and runs its own script against
 * stubbed answers, the way the settings page's cases do.
 */

// `import.meta.dirname`, not `fileURLToPath`: this file runs under jsdom, whose
// `URL` is the browser's and which `fileURLToPath` refuses as a non-file URL.
const PAGE = readFileSync(
  join(import.meta.dirname, "../public/pair.html"),
  "utf8",
);

/** The page's markup, minus the script the runner evaluates separately. */
const BODY_HTML = PAGE.slice(
  PAGE.indexOf("<body>") + "<body>".length,
  PAGE.indexOf("</body>"),
).replace(/<script[\s\S]*?<\/script>/, "");

const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

/** The key the page clears, read out of its own script. The page has no build
 *  step, so it cannot import the player's constant; this is the contract
 *  between the two, and a rename on either side fails the case below rather
 *  than silently turning the clear into a no-op. */
const PAGE_KEY = SCRIPT.match(/localStorage\.removeItem\("([^"]+)"\)/)?.[1];

const AsyncFunction = Object.getPrototypeOf(
  async (): Promise<void> => undefined,
).constructor as new (
  ...parameters: string[]
) => (fetch: unknown, location: unknown) => Promise<void>;

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Runs the page and submits its form, answering the claim and the exchange. */
async function pair(): Promise<readonly string[]> {
  document.body.innerHTML = BODY_HTML;

  const replaced: string[] = [];
  const fetchStub = vi.fn(async (input: string) => {
    if (input === "/api/pairing/claim") return json({ token: "fresh-token" });
    if (input === "/api/session") return json({});
    throw new Error(`the page fetched ${input}, which no case stubs`);
  });

  await new AsyncFunction("fetch", "location", SCRIPT)(fetchStub, {
    search: "",
    replace: (url: string) => replaced.push(url),
  });

  const form = document.querySelector("form") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(replaced).toContain("/"));

  return replaced;
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("pairing a display", () => {
  it("clears the key the player owns", () => {
    expect(PAGE_KEY).toBe(PAIRING_STORAGE_KEY);
  });

  it("says why it opened when the host sent the display here", async () => {
    // The host redirects an unpaired document to `/pair?reason=unpaired`: a
    // display whose credential was lost would otherwise have been handed a
    // text 403 it could do nothing with. A person who did not ask to pair needs
    // a sentence saying their display is not broken — and the message must not
    // promise a theme survives, because a claim mints a new record and the
    // assignment is keyed by the old id.
    document.body.innerHTML = BODY_HTML;

    await new AsyncFunction("fetch", "location", SCRIPT)(vi.fn(), {
      search: "?reason=unpaired",
      replace: () => undefined,
    });

    const status = document.querySelector<HTMLElement>("#status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain("no longer paired");
    expect(status?.textContent).not.toContain("kept");
  });

  it("says nothing when it was opened to pair a new display", async () => {
    document.body.innerHTML = BODY_HTML;

    await new AsyncFunction("fetch", "location", SCRIPT)(vi.fn(), {
      search: "",
      replace: () => undefined,
    });

    expect(document.querySelector<HTMLElement>("#status")?.hidden).toBe(true);
  });

  it("clears the token the pairing before it left in storage", async () => {
    localStorage.setItem(
      PAIRING_STORAGE_KEY,
      JSON.stringify({
        hostId: "h1",
        hostName: "study-pc",
        port: 5227,
        token: "stale-token",
        lastAddress: "192.168.1.10",
      }),
    );

    await pair();

    expect(localStorage.getItem(PAIRING_STORAGE_KEY)).toBeNull();
  });

  it("names the quarter turn a rectangle snaps a free angle to", async () => {
    document.body.innerHTML = BODY_HTML;
    // No submit here: this case is the shape control alone, and the page's
    // claim does not fire until the form is sent.
    await new AsyncFunction("fetch", "location", SCRIPT)(
      vi.fn(async () => json({})),
      { search: "", replace: () => {} },
    );

    const shape = document.querySelector("#shape") as HTMLSelectElement;
    const rotation = document.querySelector("#rotation") as HTMLInputElement;
    const note = document.querySelector("#rotation-note") as HTMLElement;

    // Typed under the default Rect and then moved to Circle: this is the state
    // the circle branch receives, so a branch that rewrote the field would be
    // caught below rather than passing because the value arrived after it ran.
    rotation.value = "45";

    shape.value = "circle";
    shape.dispatchEvent(new Event("change"));

    // Circle keeps the free angle untouched and has nothing to explain; Rect is
    // where the angle is lost.
    expect(rotation.value).toBe("45");
    expect(note.hidden).toBe(true);

    shape.value = "rect";
    shape.dispatchEvent(new Event("change"));

    // The field carries what the host validates, and the note keeps the number
    // the author typed visible rather than losing it silently (spec § "Pairing
    // and the pair page": the destructive part is named in the control).
    expect(rotation.step).toBe("90");
    expect(rotation.value).toBe("90");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("45");
    expect(note.textContent).toContain("90");

    // A later edit makes that sentence stale, so typing clears it rather than
    // leaving it beside a value it no longer describes.
    rotation.value = "180";
    rotation.dispatchEvent(new Event("input"));
    expect(note.hidden).toBe(true);
  });
});
