import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readThemePackage, writeThemePackage } from "./index.js";

const envelope = {
  schemaVersion: "2.0.0" as const,
  fabricVersion: "7.4.0",
  id: "demo",
  artboard: { width: 400, height: 300 },
  metadata: { themeLanguage: "en" },
  assets: [{ id: "logo", kind: "image" as const, path: "assets/logo.png" }],
  scene: { version: "7.4.0", objects: [] },
};

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A picture the store would accept, so a test asserts the slot and not the PNG. */
const png = (fill: number, size = PNG_HEAD.length + 1): Uint8Array => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set(PNG_HEAD);
  return bytes;
};

/** A hand-built archive, for the packages a writer would never produce. */
const archive = (
  files: Record<string, Uint8Array>,
  manifest: Record<string, unknown> = {},
): Uint8Array =>
  zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        format: "yunari-theme-package",
        version: 1,
        theme: "theme.json",
        ...manifest,
      }),
    ),
    "theme.json": strToU8(JSON.stringify(envelope)),
    ...files,
  });

/** A manifest that declares the slot, which a package carrying a picture must. */
const WITH_THUMBNAIL = { thumbnail: "thumbnail.png" } as const;

/** A package carrying `theme`, for a document the writer itself would refuse.
 *  The theme declares no assets so the archive needs no members beside it. */
function packageWith(theme: unknown): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        format: "yunari-theme-package",
        version: 1,
        theme: "theme.json",
      }),
    ),
    "theme.json": strToU8(JSON.stringify({ ...(theme as object), assets: [] })),
  });
}

describe("theme package", () => {
  it("round-trips a validated envelope and each declared asset", () => {
    const written = writeThemePackage({
      envelope,
      assets: { "assets/logo.png": new Uint8Array([1, 2, 3]) },
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const read = readThemePackage(written.bytes);
    expect(read).toMatchObject({ ok: true, envelope });
    if (read.ok)
      expect(read.assets["assets/logo.png"]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("opens a package written by the previous schema major", () => {
    const read = readThemePackage(
      packageWith({ ...envelope, schemaVersion: 2 }),
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.envelope.schemaVersion).toBe("2.0.0");
  });

  it("refuses a package from a schema major it cannot migrate", () => {
    expect(
      readThemePackage(packageWith({ ...envelope, schemaVersion: "1.0.0" })),
    ).toMatchObject({
      ok: false,
      message:
        "Schema version 1.0.0 is not supported by this build (expected 2.0.0).",
    });
  });

  it("refuses a package from a newer schema major", () => {
    expect(
      readThemePackage(packageWith({ ...envelope, schemaVersion: "3.0.0" })),
    ).toMatchObject({
      ok: false,
      message:
        "This theme was made with a newer version of Yunari (schema 3.0.0). Update Yunari to open it.",
    });
  });

  it("will not write an envelope from a previous schema major", () => {
    // The writer is the strict half of the split: a save may not smuggle an old
    // document through the migration the reader performs.
    expect(
      writeThemePackage({
        envelope: {
          ...envelope,
          schemaVersion: 2,
        } as unknown as FabricThemeEnvelope,
        assets: { "assets/logo.png": new Uint8Array([1, 2, 3]) },
      }),
    ).toMatchObject({
      ok: false,
      message: "schemaVersion is required and must be major.minor.patch.",
    });
  });

  it("refuses a valid ZIP whose declared entry exceeds the package bound", () => {
    const large = new Uint8Array(80 * 1024 * 1024 + 1);
    const theme = {
      ...envelope,
      assets: [
        { id: "large", kind: "image" as const, path: "assets/large.bin" },
      ],
    };
    const bytes = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-theme-package",
          version: 1,
          theme: "theme.json",
        }),
      ),
      "theme.json": strToU8(JSON.stringify(theme)),
      "assets/large.bin": large,
    });

    expect(readThemePackage(bytes)).toMatchObject({ ok: false });
  });

  it("refuses an archive asset that the envelope does not declare", () => {
    const bytes = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-theme-package",
          version: 1,
          theme: "theme.json",
        }),
      ),
      "theme.json": strToU8(JSON.stringify({ ...envelope, assets: [] })),
      "assets/extra.png": new Uint8Array([1]),
    });

    expect(readThemePackage(bytes)).toMatchObject({ ok: false });
  });

  it("round-trips an authored glass treatment unchanged", () => {
    const withGlass = {
      ...envelope,
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Rect",
            id: "panel",
            yunariGlass: { blurRadius: 18 },
          },
        ],
      },
    };
    const written = writeThemePackage({
      envelope: withGlass,
      assets: { "assets/logo.png": new Uint8Array([1, 2, 3]) },
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const read = readThemePackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.envelope.scene["objects"]).toEqual([
      { type: "Rect", id: "panel", yunariGlass: { blurRadius: 18 } },
    ]);
  });

  it("refuses to write or open a package whose glass treatment is out of bounds", () => {
    // A theme is validated on the way in and on the way out, so a hand-edited
    // archive cannot smuggle a radius the renderer never agreed to draw.
    const badGlass = {
      ...envelope,
      scene: {
        version: "7.4.0",
        objects: [
          { type: "Rect", id: "panel", yunariGlass: { blurRadius: 900 } },
        ],
      },
    };

    expect(
      writeThemePackage({
        envelope: badGlass,
        assets: { "assets/logo.png": new Uint8Array([1]) },
      }),
    ).toMatchObject({ ok: false });

    const bytes = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-theme-package",
          version: 1,
          theme: "theme.json",
        }),
      ),
      "theme.json": strToU8(JSON.stringify(badGlass)),
      "assets/logo.png": [new Uint8Array([1]), { level: 0 }],
    });

    expect(readThemePackage(bytes)).toMatchObject({ ok: false });
  });
});

describe("a package's thumbnail", () => {
  const assets = { "assets/logo.png": new Uint8Array([1, 2, 3]) };

  it("carries the thumbnail the export was given, and nothing else", () => {
    const written = writeThemePackage({ envelope, assets, thumbnail: png(7) });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    // The invariant, read back off the archive: every member was written on
    // purpose, and a file in the theme folder is not a member by being there.
    expect(Object.keys(unzipSync(written.bytes)).sort()).toEqual([
      "assets/logo.png",
      "manifest.json",
      "theme.json",
      "thumbnail.png",
    ]);

    const read = readThemePackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.thumbnail).toEqual(png(7));
    // The picture is not theme media, so nothing declares or loads it.
    expect(read.envelope.assets?.map((asset) => asset.path)).toEqual([
      "assets/logo.png",
    ]);
  });

  it("names the slot in the manifest, so the format is not changed silently", () => {
    const written = writeThemePackage({ envelope, assets, thumbnail: png(7) });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const manifest = JSON.parse(
      new TextDecoder().decode(unzipSync(written.bytes)["manifest.json"]!),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: "yunari-theme-package",
      version: 1,
      thumbnail: "thumbnail.png",
    });
  });

  it("exports and imports a theme that has no thumbnail", () => {
    const written = writeThemePackage({ envelope, assets });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(Object.keys(unzipSync(written.bytes))).not.toContain(
      "thumbnail.png",
    );

    const read = readThemePackage(written.bytes);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.thumbnail).toBeUndefined();
  });

  it("ignores a thumbnail that is not a PNG rather than failing the import", () => {
    const read = readThemePackage(
      archive(
        {
          "assets/logo.png": new Uint8Array([1, 2, 3]),
          "thumbnail.png": new TextEncoder().encode("not a picture at all"),
        },
        WITH_THUMBNAIL,
      ),
    );
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.thumbnail).toBeUndefined();
      expect(read.assets["assets/logo.png"]).toEqual(new Uint8Array([1, 2, 3]));
    }
  });

  it("drops an over-large thumbnail, refused the way the store refuses it", () => {
    const read = readThemePackage(
      archive(
        {
          "assets/logo.png": new Uint8Array([1, 2, 3]),
          "thumbnail.png": png(0, 2 * 1024 * 1024 + 1),
        },
        WITH_THUMBNAIL,
      ),
    );
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.thumbnail).toBeUndefined();
  });

  it("refuses a root file that is neither manifest, theme, asset nor thumbnail", () => {
    // The ruling added one deliberate exception. Everything else riding along
    // is still the hole it must not become.
    const read = readThemePackage(
      archive({
        "assets/logo.png": new Uint8Array([1, 2, 3]),
        "screenshot.png": png(7),
      }),
    );
    expect(read).toMatchObject({
      ok: false,
      message: "That package contains unsafe archive entries.",
    });
  });

  it("refuses a thumbnail the manifest does not name", () => {
    const read = readThemePackage(
      archive({
        "assets/logo.png": new Uint8Array([1, 2, 3]),
        "thumbnail.png": png(7),
      }),
    );
    expect(read).toMatchObject({
      ok: false,
      message: "A package thumbnail must be named in its manifest.",
    });
  });

  it("refuses a manifest naming any other preview file", () => {
    const bytes = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-theme-package",
          version: 1,
          theme: "theme.json",
          thumbnail: "preview.png",
        }),
      ),
      "theme.json": strToU8(JSON.stringify(envelope)),
    });

    expect(readThemePackage(bytes)).toMatchObject({
      ok: false,
      message: "Unsupported package manifest.",
    });
  });

  it("will not write a picture its own reader would refuse", () => {
    // Same rule on both sides, so the writer cannot author what it refuses.
    const notAPng = writeThemePackage({
      envelope,
      assets,
      thumbnail: new TextEncoder().encode("nope"),
    });
    expect(notAPng.ok).toBe(true);
    if (!notAPng.ok) return;
    expect(Object.keys(unzipSync(notAPng.bytes))).not.toContain(
      "thumbnail.png",
    );

    const tooBig = writeThemePackage({
      envelope,
      assets,
      thumbnail: png(0, 2 * 1024 * 1024 + 1),
    });
    expect(tooBig.ok).toBe(true);
    if (!tooBig.ok) return;
    expect(Object.keys(unzipSync(tooBig.bytes))).not.toContain("thumbnail.png");
  });

  it("refuses a declaration that would collide with the thumbnail slot", () => {
    expect(
      writeThemePackage({
        envelope: {
          ...envelope,
          assets: [{ id: "x", kind: "image" as const, path: "thumbnail.png" }],
        },
        assets: { "thumbnail.png": png(7) },
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("credits", () => {
  const credits = {
    format: "yunari-theme-credits" as const,
    version: 1 as const,
    entries: [
      {
        kind: "icon",
        title: "house",
        license: "ISC",
        changes: "Imported unchanged",
        source: { url: "https://lucide.dev/icons/house" },
      },
    ],
  };

  it("writes the member the manifest names, and reads it back", () => {
    const written = writeThemePackage({
      envelope,
      assets: { "assets/logo.png": png(1) },
      credits,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const files = unzipSync(written.bytes);
    expect(
      JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())),
    ).toMatchObject({ credits: "credits.json" });

    const read = readThemePackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.credits).toEqual(credits);
  });

  it("carries neither the member nor its manifest key without credits", () => {
    const written = writeThemePackage({
      envelope,
      assets: { "assets/logo.png": png(1) },
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const files = unzipSync(written.bytes);
    expect(Object.keys(files)).not.toContain("credits.json");
    expect(
      JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())),
    ).not.toHaveProperty("credits");

    const read = readThemePackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.credits).toBeUndefined();
  });

  it("refuses an over-cap credits list with the reader's own limit", () => {
    const sample = {
      kind: "icon",
      title: "house",
      license: "ISC",
      changes: "Imported unchanged",
      source: { url: "https://lucide.dev/icons/house" },
    };
    const entries = Array.from({ length: 257 }, (_unused, index) => ({
      ...sample,
      title: `icon-${index}`,
    }));
    expect(
      writeThemePackage({
        envelope,
        assets: { "assets/logo.png": png(1) },
        credits: { ...credits, entries },
      }),
    ).toEqual({
      ok: false,
      message: "A theme package carries at most 256 credits.",
    });
  });
});
