import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  EDITOR_THEME_SCHEMA_VERSION,
  EDITOR_THEME_TOKENS,
  readEditorThemePackage,
  readThemePackage,
  readWidgetPackage,
  writeEditorThemePackage,
} from "./index.js";

const tokens = Object.fromEntries(
  EDITOR_THEME_TOKENS.map((token) => [token, "#112233"]),
) as Record<(typeof EDITOR_THEME_TOKENS)[number], string>;

/** A hand-built package, for the shapes the writer refuses to author. */
function archive(
  theme: unknown,
  manifest: Record<string, unknown> = {},
): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        format: "yunari-theme-package",
        version: 1,
        kind: "editor-theme",
        theme: "theme.json",
        ...manifest,
      }),
    ),
    "theme.json": strToU8(JSON.stringify(theme)),
  });
}

function written(): Uint8Array {
  const result = writeEditorThemePackage({ name: "Graphite tweak", tokens });
  if (!result.ok) throw new Error(result.message);
  return result.bytes;
}

describe("editor theme package", () => {
  it("round-trips the name and the full token map", () => {
    const read = readEditorThemePackage(written());
    expect(read).toMatchObject({
      ok: true,
      document: {
        schemaVersion: EDITOR_THEME_SCHEMA_VERSION,
        name: "Graphite tweak",
        tokens,
      },
    });
  });

  it("names its kind and carries no scene or assets", () => {
    const files = unzipSync(written());
    expect(Object.keys(files).sort()).toEqual(["manifest.json", "theme.json"]);
    expect(
      JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())),
    ).toEqual({
      format: "yunari-theme-package",
      version: 1,
      kind: "editor-theme",
      theme: "theme.json",
    });
    const document = JSON.parse(
      strFromU8(files["theme.json"] ?? new Uint8Array()),
    ) as Record<string, unknown>;
    expect(document).not.toHaveProperty("scene");
    expect(document).not.toHaveProperty("artboard");
  });

  it("refuses an unknown token and names it", () => {
    expect(
      readEditorThemePackage(
        archive({
          schemaVersion: EDITOR_THEME_SCHEMA_VERSION,
          name: "Unknown",
          tokens: { ...tokens, "--made-up": "#112233" },
        }),
      ),
    ).toMatchObject({
      ok: false,
      message:
        "Editor theme token --made-up is not part of the editor-shell vocabulary.",
    });
  });

  it("refuses an invalid value and names the token", () => {
    expect(
      readEditorThemePackage(
        archive({
          schemaVersion: EDITOR_THEME_SCHEMA_VERSION,
          name: "Invalid",
          tokens: { ...tokens, "--accent": "not a colour" },
        }),
      ),
    ).toMatchObject({
      ok: false,
      message:
        'Editor theme token --accent has an invalid value "not a colour".',
    });
  });

  it("refuses a missing required token and names it", () => {
    const { "--hot": _hot, ...partial } = tokens;
    expect(
      readEditorThemePackage(
        archive({
          schemaVersion: EDITOR_THEME_SCHEMA_VERSION,
          name: "Partial",
          tokens: partial,
        }),
      ),
    ).toMatchObject({
      ok: false,
      message: "An editor theme is missing the required token --hot.",
    });
  });

  it("refuses a scene or artboard rather than reading it as a theme", () => {
    expect(
      readEditorThemePackage(
        archive({
          schemaVersion: EDITOR_THEME_SCHEMA_VERSION,
          name: "Scene",
          tokens,
          scene: { objects: [] },
        }),
      ),
    ).toMatchObject({
      ok: false,
      message: "An editor theme carries no artboard or scene.",
    });
  });

  it("refuses a schema version it cannot read", () => {
    expect(
      readEditorThemePackage(
        archive({
          schemaVersion: "3.0.0",
          name: "Newer",
          tokens,
        }),
      ),
    ).toMatchObject({
      ok: false,
      message:
        "Schema version 3.0.0 is not supported by this build (expected 1.0.0).",
    });
  });

  it("refuses a dashboard theme and a widget by name", () => {
    expect(
      readEditorThemePackage(archive({}, { kind: "theme" })),
    ).toMatchObject({
      ok: false,
      message: "That package is a dashboard theme, not an editor theme.",
    });
    expect(
      readEditorThemePackage(
        zipSync({
          "manifest.json": strToU8(
            JSON.stringify({
              format: "yunari-widget-package",
              version: 1,
              widget: "widget.json",
            }),
          ),
          "widget.json": strToU8("{}"),
        }),
      ),
    ).toMatchObject({
      ok: false,
      message: "That package is a widget, not an editor theme.",
    });
  });

  it("keeps the dashboard and widget readers refusing an editor theme", () => {
    expect(readThemePackage(written())).toMatchObject({ ok: false });
    expect(readWidgetPackage(written())).toMatchObject({ ok: false });
  });

  it("cannot author the package it would refuse", () => {
    expect(
      writeEditorThemePackage({
        name: "Invalid",
        tokens: { ...tokens, "--accent": "red" },
      }),
    ).toMatchObject({
      ok: false,
      message: 'Editor theme token --accent has an invalid value "red".',
    });
  });
});
