import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  checkDeclaredAssets,
  readThemePackage,
  writeThemePackage,
  ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  zipEntryCount,
} from "./index.js";

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

  it("checks the writer's asset rule without writing, with the writer's answer", () => {
    // Missing bytes for a declared asset: the pre-trash cleanup asks this
    // rather than compressing the package, so both must refuse identically.
    const missing = { envelope, assets: {} };
    expect(checkDeclaredAssets(missing.envelope, missing.assets)).toEqual(
      writeThemePackage(missing),
    );
    expect(checkDeclaredAssets(missing.envelope, missing.assets)).toEqual({
      ok: false,
      message: "Package assets must exactly match the theme declaration.",
    });
    expect(
      checkDeclaredAssets(envelope, { "assets/logo.png": png(1) }),
    ).toEqual({ ok: true });
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
        assetId: "asset-1",
      },
    ],
  };

  it("round-trips an assetId on a credit", () => {
    const written = writeThemePackage({
      envelope,
      assets: { "assets/logo.png": png(1) },
      credits,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const read = readThemePackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.credits?.entries[0]?.assetId).toBe("asset-1");
  });

  it("still reads a credit written before assetId existed", () => {
    const before = {
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
    const written = writeThemePackage({
      envelope,
      assets: { "assets/logo.png": png(1) },
      credits: before,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const read = readThemePackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.credits).toEqual(before);
    expect(read.credits?.entries[0]).not.toHaveProperty("assetId");
  });

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

describe("a package's archive declaration", () => {
  const assets = { "assets/logo.png": new Uint8Array([1, 2, 3]) };

  /** Location of the end-of-central-directory record, for the record surgery
   *  the writer itself would never perform. */
  function endRecord(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = bytes.byteLength - 22;
    while (eocd >= 0 && view.getUint32(eocd, true) !== 0x0605_4b50) eocd -= 1;
    if (eocd < 0) throw new Error("fixture is not a ZIP archive");
    return eocd;
  }

  /**
   * Replaces a package's end records with an EOCD/ZIP64 pair that has a
   * saturated 16-bit EOCD count and `entries` in the ZIP64 record, so only a
   * reader that follows the locator sees the real declaration.
   */
  function withZip64Count(base: Uint8Array, entries: number): Uint8Array {
    const source = new DataView(base.buffer, base.byteOffset, base.byteLength);
    const eocd = endRecord(base);
    const directoryBytes = source.getUint32(eocd + 12, true);
    const directoryOffset = source.getUint32(eocd + 16, true);

    const bytes = new Uint8Array(eocd + 98);
    bytes.set(base.subarray(0, eocd));
    const view = new DataView(bytes.buffer);
    // ZIP64 end of central directory, then its locator, then the EOCD.
    view.setUint32(eocd, 0x0606_4b50, true);
    view.setBigUint64(eocd + 4, 44n, true);
    view.setUint16(eocd + 12, 45, true);
    view.setUint16(eocd + 14, 45, true);
    view.setBigUint64(eocd + 24, BigInt(entries), true);
    view.setBigUint64(eocd + 32, BigInt(entries), true);
    view.setBigUint64(eocd + 40, BigInt(directoryBytes), true);
    view.setBigUint64(eocd + 48, BigInt(directoryOffset), true);
    view.setUint32(eocd + 56, 0x0706_4b50, true);
    view.setBigUint64(eocd + 64, BigInt(eocd), true);
    view.setUint32(eocd + 72, 1, true);
    view.setUint32(eocd + 76, 0x0605_4b50, true);
    view.setUint16(eocd + 84, 0xffff, true);
    view.setUint16(eocd + 86, 0xffff, true);
    view.setUint32(eocd + 88, directoryBytes, true);
    view.setUint32(eocd + 92, directoryOffset, true);
    return bytes;
  }

  /**
   * Wrecks the first member's deflate stream: an extractor that trusts a huge
   * declared count then fails on entry one instead of looping four billion
   * times, so the failing run stays finite.
   */
  function corruptFirstMember(bytes: Uint8Array): Uint8Array {
    const view = new DataView(bytes.buffer);
    // A fflate archive starts with the first member's local header.
    if (view.getUint32(0, true) !== 0x0403_4b50)
      throw new Error("fixture has no leading local header");
    const data = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes.fill(0xff, data, data + 8);
    return bytes;
  }

  it("refuses a crafted ZIP64 entry count before extracting anything", () => {
    const written = writeThemePackage({ envelope, assets });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const crafted = corruptFirstMember(
      withZip64Count(written.bytes, 0xffff_ffff),
    );

    expect(zipEntryCount(crafted)).toBe(0xffff_ffff);
    expect(readThemePackage(crafted)).toEqual({
      ok: false,
      message: "That package declares more than 128 archive entries.",
    });
  });

  it("refuses a truncated ZIP64 record declaring 5000 entries", () => {
    // The buffer ends inside the 56-byte ZIP64 record, but the count at +32 is
    // still readable and extraction would take it. The 16-bit EOCD count of 2
    // is not a fallback.
    const bytes = new Uint8Array(200);
    const view = new DataView(bytes.buffer);
    view.setUint32(160, 0x0606_4b50, true);
    view.setUint32(192, 5000, true);
    view.setUint32(80, 0x0706_4b50, true);
    view.setUint32(88, 160, true);
    view.setUint32(100, 0x0605_4b50, true);
    view.setUint16(108, 2, true);
    view.setUint16(110, 2, true);

    expect(zipEntryCount(bytes)).toBe(5000);
    expect(readThemePackage(bytes)).toEqual({
      ok: false,
      message: "That package declares more than 128 archive entries.",
    });
  });

  it("refuses an end record at 65,559 bytes from the end", () => {
    // A non-matching dword sits at 65,558 and the EOCD one byte past it: the
    // window fflate accepts, and the one the preflight must not give up before.
    const bytes = new Uint8Array(65_559 + 200);
    const view = new DataView(bytes.buffer);
    view.setUint32(100, 0x0606_4b50, true);
    view.setUint32(132, 5000, true);
    view.setUint32(180, 0x0706_4b50, true);
    view.setUint32(188, 100, true);
    view.setUint32(200, 0x0605_4b50, true);
    view.setUint16(208, 2, true);
    view.setUint16(210, 2, true);

    expect(zipEntryCount(bytes)).toBe(5000);
    expect(readThemePackage(bytes)).toEqual({
      ok: false,
      message: "That package declares more than 128 archive entries.",
    });
  });

  it("opens a package whose ZIP64 record declares a small count", () => {
    // A saturated 16-bit count is not a refusal on its own: the locator's
    // record says 2 — the manifest and the document — and extraction uses it.
    const written = writeThemePackage({
      envelope: { ...envelope, assets: [] },
      assets: {},
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const bytes = withZip64Count(written.bytes, 2);

    expect(zipEntryCount(bytes)).toBe(2);
    expect(readThemePackage(bytes)).toMatchObject({ ok: true });
  });

  it("refuses a declared central directory past the bound", () => {
    const written = writeThemePackage({ envelope, assets });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const bytes = written.bytes.slice();
    new DataView(bytes.buffer).setUint32(
      endRecord(bytes) + 12,
      ZIP_MAX_CENTRAL_DIRECTORY_BYTES + 1,
      true,
    );

    expect(readThemePackage(bytes)).toEqual({
      ok: false,
      message: "That package declares an oversized archive directory.",
    });
  });

  it("opens a package that fills the entry bound exactly", () => {
    const paths = Array.from(
      { length: 126 },
      (_unused, index) => `assets/a${index}.png`,
    );
    const bytes = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-theme-package",
          version: 1,
          theme: "theme.json",
        }),
      ),
      "theme.json": strToU8(
        JSON.stringify({
          ...envelope,
          assets: paths.map((path, index) => ({
            id: `a${index}`,
            kind: "image" as const,
            path,
          })),
        }),
      ),
      ...Object.fromEntries(paths.map((path) => [path, new Uint8Array([1])])),
    });

    expect(zipEntryCount(bytes)).toBe(128);
    expect(readThemePackage(bytes)).toMatchObject({ ok: true });
  });
});
