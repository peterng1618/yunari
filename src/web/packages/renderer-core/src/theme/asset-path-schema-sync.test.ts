import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSET_PATH_PATTERN, FONT_ASSET_FORMATS } from "./document.js";

/**
 * The published schema hand-spells the asset-path rule rather than importing
 * it, so the two can drift. `envelope-keys-disagreement.test.ts` compares key
 * names; this compares the pattern bodies, which is the half nothing read.
 */

const SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../../../../../schema/theme-document.schema.json",
    import.meta.url,
  ),
);

type Node = Record<string, unknown>;

function patternAt(def: string): string {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Node;
  const definition = (schema["$defs"] as Node)[def] as Node;
  const properties = definition["properties"] as Node;
  const path = properties["path"] as Node;
  const pattern = path["pattern"];
  expect(typeof pattern, `$defs.${def}.path.pattern must be published`).toBe(
    "string",
  );
  return pattern as string;
}

/** A regex literal escapes `/`; a JSON pattern does not. */
const plain = (source: string) => source.replaceAll("\\/", "/");

describe("the published asset-path pattern", () => {
  it("spells the same rule as ASSET_PATH_PATTERN", () => {
    const code = plain(ASSET_PATH_PATTERN.source);
    expect(code.endsWith("$")).toBe(true);
    expect(plain(patternAt("nonFontAssetReference"))).toBe(code);
  });

  it("adds the font extension list the code validates", () => {
    const code = plain(ASSET_PATH_PATTERN.source);
    const expected = `${code.slice(0, -1)}\\.(${FONT_ASSET_FORMATS.join("|")})$`;
    expect(plain(patternAt("fontAssetReference"))).toBe(expected);
  });
});
