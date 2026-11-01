import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The theme id shape has one owner, `STABLE_ID_PATTERN` in
 * `renderer-core/src/theme/document.ts`. Before this guard six modules spelled
 * `/^[A-Za-z0-9_-]{1,64}$/` themselves and the shape could drift between them.
 *
 * The other keys that happen to accept the same characters are deliberately
 * absent: credential ids, secret names, font-favourite trio ids and the theme
 * store's nonce are their own vocabularies. Importing this pattern would make
 * independent namespaces look like one.
 *
 * `themeIdFromName` in `@yunari/theme-package` is also absent on purpose: it
 * *derives* a value in this shape, while this pattern *validates* one.
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
