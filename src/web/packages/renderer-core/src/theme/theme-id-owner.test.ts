import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { newThemeId, STABLE_ID_PATTERN } from "./document.js";

/**
 * The theme id has one owner, `document.ts`: `STABLE_ID_PATTERN` validates it
 * and `newThemeId` mints it. Before this guard six modules spelled
 * `/^[A-Za-z0-9_-]{1,64}$/` themselves and the shape could drift between them;
 * before the minting guard a new document's id was a UUID on every path except
 * Save as, which derived a slug from the name.
 *
 * The other keys that happen to accept the same characters are deliberately
 * absent: credential ids, secret names, font-favourite trio ids and the theme
 * store's nonce are their own vocabularies. Importing this pattern would make
 * independent namespaces look like one.
 *
 * `themeIdFromName` in `@yunari/theme-package` is also absent on purpose: it
 * names a package file and is the host import's fallback when a package
 * carries no usable id. It is never how a new document is minted.
 */

const SOURCE = fileURLToPath(new URL("../../..", import.meta.url));

const CONSUMERS = [
  "renderer-core/src/theme/document.ts",
  "host/src/settings/active-theme.ts",
  "host/src/settings/theme-settings.ts",
  "host/src/settings/theme-origins.ts",
  "host/src/themes/store.ts",
  "player/src/theme-loader.ts",
  "editor/src/theme-library-client.ts",
  "editor/src/persist.ts",
] as const;

function text(relative: string): string {
  return readFileSync(join(SOURCE, relative), "utf8");
}

describe("the theme id shape", () => {
  it("is imported rather than re-spelled in every theme-id module", () => {
    // The owner keeps the literal; every other module imports it.
    expect(text(CONSUMERS[0])).toMatch(/\/\^\[A-Za-z0-9_-\]\{1,64\}\$\//);

    for (const file of CONSUMERS.slice(1)) {
      const source = text(file);

      expect(source, file).not.toMatch(/\/\^\[A-Za-z0-9_-\]\{1,64\}\$\//);
      expect(source, file).toContain("STABLE_ID_PATTERN");
    }
  });

  it("is exported from the package barrel", () => {
    expect(text("renderer-core/src/index.ts")).toContain("STABLE_ID_PATTERN");
  });
});

describe("a new theme id", () => {
  /** The producers that make a document rather than read one. A producer that
   *  spells its own id is the defect this guards: Save as did, from the name. */
  const MINTERS = [
    "theme-kit/src/starter.ts",
    "editor/src/theme-library-manager/index.ts",
  ] as const;

  it("is a UUID in the stable shape", () => {
    const id = newThemeId();

    expect(id).toMatch(STABLE_ID_PATTERN);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("is minted through the owner in every producer", () => {
    for (const file of MINTERS) {
      const source = text(file);

      expect(source, file).toContain("newThemeId");
      expect(source, file).not.toMatch(/id:\s*crypto\.randomUUID\(\)/);
      expect(source, file).not.toContain("themeIdFromName");
    }
  });

  it("is exported from the package barrel", () => {
    expect(text("renderer-core/src/index.ts")).toContain("newThemeId");
  });
});
