import { describe, expect, it } from "vitest";
import { requestMobileExport } from "./export-mobile.js";

/**
 * Opt-in: drives the author's own Wallpaper Engine window, so it is never part
 * of the gate. `YUNARI_WE_LIVE=1` runs it; `YUNARI_WE_LIVE_TITLE` picks the
 * project, which must already be unpacked into `projects/myprojects/`.
 *
 * It stops at the native Save dialog, which is the author's step, so the test
 * leaves one open — dismiss it before running anything else.
 */
const live = process.env.YUNARI_WE_LIVE === "1";

describe.runIf(live)("mobile export against the running engine", () => {
  it("reaches the engine's Save dialog for an unpacked local project", async () => {
    const result = await requestMobileExport({
      title: process.env.YUNARI_WE_LIVE_TITLE ?? "Full Moon [FHD]",
      timeoutMs: 360_000,
    });

    expect(result.ok ? null : result.reason).toBeNull();
  }, 400_000);
});
