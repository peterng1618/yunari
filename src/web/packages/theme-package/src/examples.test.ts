import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  readEditorThemePackage,
  readPathPresetPack,
  readThemePackage,
  readWidgetPackage,
} from "./index.js";

/**
 * The shipped examples are the formats' only worked examples. Each is zipped
 * and read through the reader the host uses, so an example that stops matching
 * its reader fails here rather than in a user's install.
 */

const EXAMPLES = fileURLToPath(
  new URL("../../../../../examples", import.meta.url),
);

function directoryOf(...segments: readonly string[]): string {
  return path.join(EXAMPLES, ...segments);
}

/** Every file under one example, zipped the way the install route expects: at
 *  the archive root, with no enclosing folder. */
function zipOf(directory: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const name of readdirSync(directory)) {
    files[name] = new Uint8Array(readFileSync(path.join(directory, name)));
  }
  return zipSync(files);
}

function assertPack(result: { readonly ok: boolean }): void {
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

describe("shipped pack examples", () => {
  it("reads the dashboard theme", () => {
    assertPack(
      readThemePackage(zipOf(directoryOf("packs", "dashboard-theme"))),
    );
  });

  it("reads the editor theme", () => {
    assertPack(
      readEditorThemePackage(zipOf(directoryOf("packs", "editor-theme"))),
    );
  });

  it("reads the widget pack", () => {
    assertPack(readWidgetPackage(zipOf(directoryOf("packs", "widget-pack"))));
  });

  it("reads the path preset pack", () => {
    const file = path.join(
      directoryOf("packs", "path-preset-pack"),
      "pack.json",
    );
    const result = readPathPresetPack(
      JSON.parse(readFileSync(file, "utf8")) as unknown,
    );
    assertPack(result);
    if (!result.ok) return;
    expect(result.pack.presets.map((preset) => preset.paint)).toEqual([
      "stroke",
      "fill",
    ]);
  });
});
