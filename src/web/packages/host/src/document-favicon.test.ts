import { readFileSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./providers/registry.js";
import { createHostServer } from "./server.js";

/**
 * Every page the host serves names an icon the host actually serves.
 *
 * A document with no `<link rel="icon">` makes the browser probe
 * `/favicon.ico`, get a 404 and log it — on a clean load, which is the worst
 * place for a console error to sit because it teaches the eye to skip the
 * console. The editor and the player were fixed in `8e0c452`; the host's own
 * pages were left for their owner, and they 404 the same way.
 *
 * The mark is one file the editor and the player already keep in step by hand.
 * It is copied rather than moved because each is a separate bundle served from
 * a separate root, and the test below is what notices when one drifts.
 */

/** The two files on disk, and the first-run page the host composes. */
const ADMIN_DIR = fileURLToPath(new URL("../public", import.meta.url));
const EDITOR_MARK = fileURLToPath(
  new URL("../../editor/public/favicon.svg", import.meta.url),
);

const FILES = [
  { name: "chooser", document: join(ADMIN_DIR, "library.html") },
  { name: "settings", document: join(ADMIN_DIR, "settings.html") },
];

/** The first-run page is a template literal, not a file, so it is read off a
 *  real host: the browser proof is that a page load fetches the icon, and this
 *  is the half of it that does not need a browser. */
async function firstRunHtml(): Promise<string> {
  const hosted = createHostServer({
    registry: new ProviderRegistry([]),
    // No themes are stored, so `/` falls through to the first-run page.
    bundles: { player: ADMIN_DIR, editor: ADMIN_DIR, admin: ADMIN_DIR },
  });
  // Port 0 asks the OS for a free one, so this never collides with a host
  // another agent is running.
  await new Promise<void>((resolve) => {
    hosted.server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = hosted.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/`);
    return response.ok ? await response.text() : "";
  } finally {
    await hosted.close();
  }
}

const declared = (html: string): string =>
  html.match(/<link\b[^>]*\brel="icon"[^>]*>/)?.[0] ?? "";

const href = (html: string): string | undefined =>
  declared(html).match(/\bhref="([^"]+)"/)?.[1];

describe("the host's own pages name an icon", () => {
  for (const site of FILES) {
    it(`${site.name} declares one`, () => {
      const link = declared(readFileSync(site.document, "utf8"));

      expect(link, `${site.name} declares no icon link`).not.toBe("");
    });
  }

  it("the first-run page declares one a display on the LAN can fetch", async () => {
    // `/` is served to a paired display over the LAN, unlike `/settings`, so
    // the first-run page must name the bundle-exempt root rather than the
    // loopback-only settings path.
    expect(href(await firstRunHtml())).toBe("/favicon.svg");
  });
});

describe("the icon is the mark the host already ships", () => {
  it("is served from the bundle-exempt root, so a LAN display can fetch it", () => {
    // All three pages name the same path, and it is the one the display guard
    // exempts. `/settings` is loopback-only, so a display served the chooser or
    // the first-run page over the LAN was refused the icon those pages declared.
    for (const site of FILES) {
      expect(href(readFileSync(site.document, "utf8"))).toBe("/favicon.svg");
    }
  });

  it("resolves to a file the host serves, byte for byte", () => {
    const served = join(ADMIN_DIR, "favicon.svg");
    const shipped = ((): boolean => {
      try {
        return statSync(served).isDirectory() === false;
      } catch {
        return false;
      }
    })();

    // A link to a file the host does not carry produces the same 404 with the
    // same silence, so the file's existence is half the assertion.
    expect(shipped, "named but not shipped").toBe(true);
    // One product, one mark: a per-surface design would be a second logo. The
    // editor and the player keep their copies in step by hand and this is what
    // notices when one drifts.
    expect(readFileSync(served, "utf8")).toBe(
      readFileSync(EDITOR_MARK, "utf8"),
    );
  });
});
