import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import { starterBackdrop } from "./starter-backdrop.js";

/**
 * The editor's own backdrop declaration, under test where it lives.
 *
 * The composition is the kit's, but `starterBackdrop` is the editor's: its id,
 * path, digest and licence are the values a saved theme will carry, and a kit
 * fixture cannot prove the editor still passes them.
 */
describe("createNewFabricTheme", () => {
  it("declares the editor's backdrop and mounts it as the theme media", () => {
    const theme = createNewFabricTheme();
    expect(theme.assets).toEqual([starterBackdrop]);
    expect(theme.background?.media).toEqual({
      assetId: starterBackdrop.id,
      bounds: "theme",
    });
  });

  it("declares a digest that is really the packaged JPEG", () => {
    const bytes = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "starter-backdrop.jpg"),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      starterBackdrop.sha256,
    );
  });
});
