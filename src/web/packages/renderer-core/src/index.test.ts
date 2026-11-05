import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The legacy DOM mount path is retired, and the line clamp went with it.
 * `PlanTextLayout` has no consumer now that `mountScene` is gone, so the
 * public arithmetic is not exported: the export, the barrel entry and
 * `plan.test.ts`'s cases go together. This is a **public-surface** rule, so the
 * case reads the surface — the barrel and the retired file — rather than a
 * behaviour. `SceneHandle` survives: `scene-fabric`'s `FabricSceneHandle`
 * extends it and the player types against it.
 */
describe("the legacy DOM mount and the clamp are gone", () => {
  it("exports neither mountScene nor computeMaxLines", () => {
    expect("mountScene" in core).toBe(false);
    expect("computeMaxLines" in core).toBe(false);
  });

  it("keeps no scene/mount module", () => {
    expect(() =>
      readFileSync(resolve(here, "scene/mount.ts"), "utf8"),
    ).toThrow();
  });
});
