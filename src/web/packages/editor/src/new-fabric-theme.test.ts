import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bundledStarterAssets,
  bundledStarterEnvelope,
  loadBundledStarter,
} from "./bundled/starter.js";
import { createNewFabricTheme, STARTER_TEMPLATE } from "./new-fabric-theme.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed bytes, handed to the loader the way the browser hands the
 *  emitted asset URL. */
function fetchZip(name: string): typeof fetch {
  const bytes = new Uint8Array(readFileSync(resolve(HERE, "bundled", name)));
  return (async () => new Response(bytes)) as typeof fetch;
}

describe("the bundled starter template", () => {
  it("opens the starter from the bundled package", async () => {
    await loadBundledStarter(fetchZip("starter.theme.zip"));

    const envelope = bundledStarterEnvelope();
    // The saved id is stable: a theme opened from the template keeps the id
    // every copy of the product shipped.
    expect(envelope.id).toBe("yunari-starter-template");
    // The reference composition: two loose labels over the eight cards.
    expect(envelope.scene.objects).toHaveLength(10);
    expect(Object.keys(bundledStarterAssets())).toEqual([
      "assets/starter-backdrop.jpg",
    ]);
  });

  it("hands out copies, so opening the template cannot edit the bundle", async () => {
    await loadBundledStarter(fetchZip("starter.theme.zip"));

    const first = bundledStarterEnvelope();
    const second = bundledStarterEnvelope();
    expect(first).not.toBe(second);
    expect(first.scene).not.toBe(second.scene);

    const assets = bundledStarterAssets();
    const again = bundledStarterAssets();
    expect(assets["assets/starter-backdrop.jpg"]).toBeDefined();
    expect(assets["assets/starter-backdrop.jpg"]).not.toBe(
      again["assets/starter-backdrop.jpg"],
    );
  });

  it("imports no generator module", () => {
    const source = readFileSync(
      "packages/editor/src/new-fabric-theme.ts",
      "utf8",
    );
    expect(source).not.toContain("createStarterTheme");
    expect(source).not.toContain("starter-backdrop");
  });
});

describe("createNewFabricTheme", () => {
  it("is the loaded template, with the backdrop declared as theme media", async () => {
    await loadBundledStarter(fetchZip("starter.theme.zip"));

    const theme = createNewFabricTheme();
    expect(theme.assets).toHaveLength(1);
    expect(theme.background?.media).toEqual({
      assetId: "starter-backdrop",
      color: { ref: "palette.none" },
      bounds: "theme",
    });
  });

  it("mints a fresh document id for every template open", async () => {
    await loadBundledStarter(fetchZip("starter.theme.zip"));

    const first = createNewFabricTheme();
    const second = createNewFabricTheme();
    expect(first.id).not.toBe(second.id);
    expect(first.id).not.toBe(STARTER_TEMPLATE.id);
    expect(second.id).not.toBe(STARTER_TEMPLATE.id);

    // The template keeps its stable id; only the opened document's id changes.
    const bundled = bundledStarterEnvelope();
    expect(bundled.id).toBe(STARTER_TEMPLATE.id);
    expect({ ...first, id: bundled.id }).toEqual(bundled);
  });
});
