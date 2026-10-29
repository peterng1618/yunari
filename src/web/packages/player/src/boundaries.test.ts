import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The player's import boundary, asserted rather than hoped for.
 *
 * ## Why this exists at all
 *
 * §47 requires the display-only bundle to download no editor controls or
 * inspectors, and until now the **only** thing enforcing that was
 * `scripts/check-size.mjs` noticing the bundle got bigger. Measured
 * 2026-09-15: the player is 201.1 KB gzip against a 400 KB budget, so there is
 * ~199 KB of slack — enough to leak the entire editor and still pass. A gate
 * with 2x headroom detects nothing, which makes it the wrong instrument for a
 * boundary. This catches the leak at the import, where it can be explained.
 *
 * ## Why Fabric made it urgent
 *
 * Two of the three rules below are Fabric-specific and both cost real bytes:
 *
 * - **`fabric` versus `fabric/es`.** The default entry resolves to one
 *   pre-bundled, pre-minified file that a tree-shaker cannot see into. The same
 *   five named imports measured **95.0 KB gzip through `fabric` and 49.3 KB
 *   through `fabric/es`**. `./es` carries the same type declarations, so there
 *   is no reason to take the expensive one — but it is the shorter, more
 *   habitual specifier, and nothing else would ever flag it.
 * - **`StaticCanvas` versus `Canvas`.** The interactive canvas brings pointer
 *   handling, selection and drag: **+31.0 KB gzip** the player can never use.
 *   `StaticCanvas` genuinely excludes them, so the shared scene adapter must
 *   stay canvas-agnostic and take a `StaticCanvas`, leaving `packages/editor`
 *   as the only place that constructs the interactive one. If that inverts, the
 *   player inherits the editor's canvas through a shared module and the size
 *   gate absorbs it in silence.
 *
 * The measurements are recorded here.
 */

const PACKAGES_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * Packages whose sources ship inside the display-only bundle.
 *
 * `scene-fabric` is the one that actually imports Fabric, so omitting it would
 * make the two Fabric rules below assert nothing at all — which is why the
 * harness test at the bottom checks that this list resolves to real sources.
 */
const DISPLAY_PACKAGES = ["renderer-core", "scene-fabric", "player"] as const;

function sourceFiles(directory: string): string[] {
  if (!statSync(directory).isDirectory()) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

interface ImportRecord {
  readonly file: string;
  readonly specifier: string;
  /** The binding clause as written, e.g. `{ StaticCanvas, Rect }`. */
  readonly clause: string;
  /** Written as `import type …`, so it vanishes at runtime and costs nothing. */
  readonly typeOnly: boolean;
}

function importsIn(packages: readonly string[]): ImportRecord[] {
  return packages.flatMap((name) => {
    const root = join(PACKAGES_ROOT, name, "src");

    return sourceFiles(root).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const relativeFile = relative(PACKAGES_ROOT, file).replaceAll("\\", "/");

      return [
        ...source.matchAll(
          /(?:^|\n)\s*(?:import|export)(\s+type)?\s*([^'"\n]*?)\s*from\s*['"]([^'"]+)['"]/g,
        ),
      ].map((match) => ({
        file: relativeFile,
        specifier: match[3]!,
        clause: match[2] ?? "",
        typeOnly: match[1] !== undefined,
      }));
    });
  });
}

/** Named bindings in an import clause, so `StaticCanvas` never matches `Canvas`. */
function namedBindings(clause: string): string[] {
  const braced = /\{([^}]*)\}/.exec(clause);

  if (braced === null) {
    return [];
  }

  return braced[1]!
    .split(",")
    .map((part) =>
      part
        .replace(/^\s*type\s+/, "")
        .split(/\s+as\s+/)[0]!
        .trim(),
    )
    .filter((name) => name.length > 0);
}

describe("the display bundle imports Fabric the cheap way", () => {
  it("never imports the bare `fabric` specifier", () => {
    const offenders = importsIn(DISPLAY_PACKAGES)
      .filter((record) => record.specifier === "fabric")
      .map((record) => record.file);

    // Not a style preference: 95.0 KB gzip against 49.3 KB for the identical
    // imports, because the default entry is pre-bundled. `fabric/es` ships the
    // same types.
    expect(
      offenders,
      `import from 'fabric/es' instead — the bare specifier costs ~45 KB gzip:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("only imports Fabric from the `fabric/es` subpath", () => {
    const offenders = importsIn(DISPLAY_PACKAGES)
      .filter(
        (record) =>
          record.specifier.startsWith("fabric") &&
          record.specifier !== "fabric/es" &&
          !record.specifier.startsWith("fabric/es/"),
      )
      .map((record) => `${record.file} -> ${record.specifier}`);

    // `fabric/node` is server code a browser bundle cannot use.
    // `fabric/extensions` is browser EDITOR code — aligning guidelines, crop and
    // gradient controls, all of which need the interactive `Canvas`. A display
    // has no use for any of it, and its files import from bare `fabric`, so it
    // would also breach the rule above. That makes it wrong *here*; it is not
    // wrong in `packages/editor`, which this test does not scan; that package
    // adopts `AligningGuidelines` from it rather than reimplementing snapping.
    // Do not read this rule as a ban on the subpath.
    expect(
      offenders,
      `unexpected Fabric entry point:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the interactive canvas belongs to the editor", () => {
  it("is never imported by a package that ships in the player", () => {
    const offenders = importsIn(DISPLAY_PACKAGES)
      .filter(
        (record) => record.specifier.startsWith("fabric") && !record.typeOnly,
      )
      .filter((record) => namedBindings(record.clause).includes("Canvas"))
      .map((record) => record.file);

    // +31.0 KB gzip of pointer handling, selection and drag that a phone can
    // never use. The shared adapter takes a `StaticCanvas`; `packages/editor`
    // constructs the interactive one.
    expect(
      offenders,
      `use StaticCanvas — the interactive Canvas costs ~31 KB gzip the player cannot use:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the player cannot reach the editor", () => {
  it("has no import path into @yunari/editor", () => {
    const offenders = importsIn(DISPLAY_PACKAGES)
      .filter(
        (record) =>
          record.specifier.includes("@yunari/editor") ||
          record.specifier.includes("packages/editor"),
      )
      .map((record) => `${record.file} -> ${record.specifier}`);

    // The §47 gate has ~199 KB of slack, so it would not notice this.
    expect(
      offenders,
      `editor code reaching the display bundle:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the player has one renderer", () => {
  it("does not import the legacy DOM mount", () => {
    const offenders = importsIn(["player"])
      .filter(
        (record) =>
          !record.typeOnly &&
          namedBindings(record.clause).includes("mountScene"),
      )
      .map((record) => record.file);

    expect(offenders).toEqual([]);
  });
});

describe("the harness itself works", () => {
  it("finds the sources it is supposed to be checking", () => {
    // A boundary test that silently scans nothing passes forever. This is the
    // guard on the guard: `sourceFiles` walks two packages by path, so a
    // rename would otherwise turn every assertion above into a no-op.
    const records = importsIn(DISPLAY_PACKAGES);

    expect(records.length).toBeGreaterThan(50);
    expect(
      records.some((record) => record.specifier.startsWith("echarts")),
    ).toBe(true);
  });

  it("actually sees a Fabric import", () => {
    // Without this, the two Fabric rules above are vacuously true the moment
    // `scene-fabric` is renamed, moved, or dropped from DISPLAY_PACKAGES —
    // and a vacuous boundary test is worse than none, because it reports
    // green. If this fails, fix the list rather than deleting the assertion.
    const fabricImports = importsIn(DISPLAY_PACKAGES).filter((record) =>
      record.specifier.startsWith("fabric"),
    );

    expect(fabricImports.length).toBeGreaterThan(0);
    expect(
      fabricImports.every((record) => record.specifier === "fabric/es"),
    ).toBe(true);
  });

  it("distinguishes StaticCanvas from Canvas", () => {
    expect(namedBindings("{ StaticCanvas, Rect }")).toEqual([
      "StaticCanvas",
      "Rect",
    ]);
    expect(namedBindings("{ Canvas }")).toEqual(["Canvas"]);
    expect(namedBindings("{ StaticCanvas as Scene }")).toEqual([
      "StaticCanvas",
    ]);
    expect(namedBindings("{ type FabricObject }")).toEqual(["FabricObject"]);
    expect(namedBindings("* as fabric")).toEqual([]);
  });
});
