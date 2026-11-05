import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), "utf8");

/**
 * `importImage` carried a `scale` option nothing read: the body decoded and
 * fitted the image by its own rule, while `asset-manager` passed
 * `scale: "image-contain"` as if it had chosen the fit. The fix is the option's
 * **removal**, so the case that observes it is the absence of the three
 * literals — in the declaration, in the `EditorInteraction` type, and at every
 * call site. It fails while any of them is still there.
 *
 * `"image-cover"` and `"scale-montage"` are also the two `unreachable-branch`
 * candidates the sweep attributed to this option; removing the union removes
 * both.
 */
const CALL_SITES = [
  "./index.ts",
  "../asset-manager/index.ts",
  "../clipboard-manager/index.ts",
  "../editor-interaction.ts",
  "../editor-shell.ts",
] as const;

describe("importImage's inert fit option is gone", () => {
  it.each(CALL_SITES)("names no image fit in %s", (rel) => {
    expect(read(rel)).not.toMatch(/"image-(contain|cover)"|"scale-montage"/);
  });
});
