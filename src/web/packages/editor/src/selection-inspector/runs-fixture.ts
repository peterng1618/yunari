/**
 * The globals `runs.dom.test.tsx` mounts the run editor over.
 *
 * A document's own palette and type presets — the values a run resolves through
 * — rather than styling the shell paints, so the fixture lives beside the test
 * that drives it.
 */
import type { FabricGlobals } from "@yunari/renderer-core";

export const RUN_GLOBALS = {
  typeTokens: {
    plain: { family: "Inter" },
    caption: { family: "Inter" },
    title: { family: "Inter" },
  },
  palette: {
    text: { name: "Text", value: { kind: "solid", color: "#fff" } },
  },
} as unknown as FabricGlobals;
