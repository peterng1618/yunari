// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const PAIRING_KEY = "yunari.display.pairing";

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
  it("clears the token the pairing before it left in storage", async () => {
    localStorage.setItem(
      PAIRING_KEY,
      JSON.stringify({
        hostId: "h1",
        hostName: "study-pc",
        port: 5227,
        token: "stale-token",
        lastAddress: "192.168.1.10",
      }),
    );

    await pair();

    expect(localStorage.getItem(PAIRING_KEY)).toBeNull();
  });
});
