import { expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import { checkSync } from "../../../../scripts/design-md.mjs";

/**
 * The sync check's own proof. `design-md.mjs` is the reader `npm run design:check`
 * calls, so its rule is exercised against inline fixtures here rather than only
 * against the real file — a check that passes because it read a constant is the
 * defect a gate exists to remove. The real tree is red-proofed separately by
 * `--sync` itself.
 */

type Read = {
  readonly design?: string;
  readonly css?: string;
};

/** A read of the world with only the pieces a case needs. */
function fixture(partial: Read): Read {
  return { design: "", css: "", ...partial };
}

const whats = (findings: readonly { readonly what: string }[]) =>
  findings.map((f) => f.what);

it("fails a scale the stylesheet and the front matter disagree on", () => {
  const read = fixture({
    css: "--space-16: 15px;",
    design: "spacing:\n  16: 16px\n",
  });
  const findings = checkSync(read);
  expect(findings.map((f) => f.what)).toEqual(["space-16"]);
});

it("reads the @theme static block, not :root", () => {
  const read = fixture({
    css: "@theme static {\n  --space-16: 16px;\n}\n:root {\n  --space-16: 99px;\n}\n",
    design: "spacing:\n  16: 16px\n",
  });
  expect(checkSync(read)).toEqual([]);
});

it("fails a name only one side declares, in either direction", () => {
  expect(
    whats(checkSync(fixture({ css: "", design: "spacing:\n  16: 16px\n" }))),
  ).toEqual(["space-16"]);
  expect(
    whats(
      checkSync(
        fixture({
          css: "@theme static {\n  --radius-lg: 8px;\n}\n",
          design: "",
        }),
      ),
    ),
  ).toEqual(["radius-lg"]);
});

it("treats the typography line-height companion as its own token", () => {
  const read = fixture({
    css: "@theme static {\n  --text-md: 13px;\n  --text-md--line-height: 1.5;\n}\n",
    design: "typography:\n  md:\n    fontSize: 13px\n    lineHeight: 1.3\n",
  });
  expect(whats(checkSync(read))).toEqual(["text-md--line-height"]);
});

it("reads the front matter's typography keys as the bare suffix", () => {
  // `--text-2xs`, not `--text-text-2xs`: the key is the scale-level suffix.
  const read = fixture({
    css: "@theme static {\n  --text-2xs: 10px;\n  --text-2xs--line-height: 1.2;\n}\n",
    design: "typography:\n  2xs:\n    fontSize: 10px\n    lineHeight: 1.2\n",
  });
  expect(checkSync(read)).toEqual([]);
});

it("ignores a name outside the three synced groups", () => {
  // Tailwind's own base and the elevation tokens are not front-matter material.
  const read = fixture({
    css: "@theme static {\n  --spacing: 0.25rem;\n  --shadow-raised: 0 12px 28px #000;\n}\n",
    design: "",
  });
  expect(checkSync(read)).toEqual([]);
});
