// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as themeListModule from "../public/theme-list.js";

/**
 * Where the host's pages send an author who wants to change a theme.
 *
 * Both pages offered "Open the editor" as a bare `/editor/`, and the editor
 * opened its own default whatever the URL said. So a consumer who picked a
 * theme, read its questions on `/settings` and went to change it arrived
 * somewhere else entirely — and the editor's own *Open library* dialog was the
 * only way back to a saved theme that existed.
 *
 * The pages are static documents the host serves as-is, so this reads the file
 * and runs its script against stubbed answers rather than importing anything.
 * Both pages are covered here because both carry the link, and the copy that
 * arrives second is the one that gets forgotten.
 */

// `import.meta.dirname`, not `fileURLToPath`: this runs under jsdom, whose
// `URL` is the browser's and which `fileURLToPath` refuses as a non-file URL.
const PUBLIC = join(import.meta.dirname, "../public");

/** The page's markup, minus the script the runner evaluates separately. */
function bodyOf(page: string): string {
  const html = readFileSync(join(PUBLIC, page), "utf8");
  return html
    .slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"))
    .replace(/<script[\s\S]*?<\/script>/, "");
}

/** The page's one module, with its import handed the real `theme-list.js`.
 *
 *  `/settings/theme-list.js` is a URL only a host serves, so the script cannot
 *  import it itself — but `library.html` calls the module's own resolution rule
 *  (`shownTheme`) to build the link, so a stand-in would be testing the
 *  stand-in. The module is passed in as `__themeList` and the import line
 *  becomes a destructuring of it, which is also how a name added to a page's
 *  import cannot arrive undefined. `settings.html` imports nothing, so the
 *  rewrite matches nothing there and the parameter is simply unused. */
function scriptOf(page: string): string {
  const html = readFileSync(join(PUBLIC, page), "utf8");
  return (
    html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? ""
  ).replace(
    /^\s*import\s*\{([^}]*)\}[^\n]*$/gm,
    (_statement, names: string) => `const {${names}} = __themeList;`,
  );
}

const AsyncFunction = Object.getPrototypeOf(
  async (): Promise<void> => undefined,
).constructor as new (
  parameter: string,
  source: string,
) => (themeList: unknown) => Promise<void>;

const json = (body: unknown): Response =>
  ({
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

interface Display {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly theme: string | null;
}

const THIS_PC: Display = {
  id: "this-pc",
  label: "Host",
  kind: "local",
  theme: null,
};

/** One saved theme: these cases are about which theme the link carries, not
 *  about a list of them. */
const THEMES = [{ id: "living-room", name: "Living Room" }];

/** The answers both pages ask for. `active` is the theme the default display
 *  holds — the row both pages open on — and it is the only thing under test
 *  that varies. */
function stub(
  active: string | null,
  displays: readonly Display[] = [THIS_PC],
): void {
  globalThis.fetch = (async (input: string) => {
    switch (input) {
      case "/api/themes/active":
        return json({
          themes: THEMES,
          templates: [],
          default: active,
          displays,
        });
      case "/api/devices":
        return json({
          available: { gpus: [], disks: [] },
          assigned: { assigned: {}, names: {} },
        });
      case "/api/display":
        return json({ zones: ["Europe/London"], settings: {} });
      default:
        return json({ required: [], answers: {} });
    }
  }) as unknown as typeof globalThis.fetch;
}

const realFetch = globalThis.fetch;

async function open(
  page: string,
  active: string | null,
  displays: readonly Display[] = [THIS_PC],
): Promise<void> {
  document.body.innerHTML = bodyOf(page);
  stub(active, displays);
  await new AsyncFunction("__themeList", scriptOf(page))(themeListModule);
}

afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.replaceChildren();
});

for (const page of ["settings.html", "library.html"]) {
  describe(`${page}'s link into the editor`, () => {
    it("carries the theme the Host is showing", async () => {
      await open(page, "living-room");

      // The point of the whole change: an author who picks a theme and then
      // goes to change it arrives on that theme. A bare `/editor/` did not,
      // and the editor silently opened something else.
      expect(document.querySelector("#editor-link")?.getAttribute("href")).toBe(
        "/editor/?theme=living-room",
      );
    });

    it("stays a plain link when no theme is active, because there is none to carry", async () => {
      await open(page, null);
      expect(document.querySelector("#editor-link")?.getAttribute("href")).toBe(
        "/editor/",
      );
    });

    it("names the editor in the link's own text, which is its accessible name", async () => {
      await open(page, "living-room");

      expect(document.querySelector("#editor-link")?.textContent).toBe(
        "Open the editor",
      );
    });
  });
}

/**
 * The chooser's link follows the row that is pressed, and it is the chooser's
 * alone now: the column those rows live in is `library.html`'s, since the
 * settings page stopped listing themes (R116). Its link still carries the
 * default's theme, which is what the three cases above read.
 */
describe("the chooser's link into the editor", () => {
  it("carries the theme of the display whose row is pressed", async () => {
    // The default row opens pressed, so every case above is about the fallback.
    // A display holding a theme of its own is the case the column exists for:
    // pressing its row has to move the link to what that display shows, not to
    // what the default holds.
    await open("library.html", "living-room", [
      { ...THIS_PC, theme: "kitchen-strip" },
    ]);

    expect(document.querySelector("#editor-link")?.getAttribute("href")).toBe(
      "/editor/?theme=living-room",
    );

    document
      .querySelector<HTMLButtonElement>('[data-display="this-pc"]')
      ?.click();

    expect(document.querySelector("#editor-link")?.getAttribute("href")).toBe(
      "/editor/?theme=kitchen-strip",
    );
  });
});
