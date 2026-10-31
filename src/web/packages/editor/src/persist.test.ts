import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import {
  fileNameFor,
  parseThemePackage,
  serializeThemePackage,
} from "./persist.js";

const validEnvelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "living-room",
  artboard: { width: 1920, height: 1080 },
  metadata: { name: "Living Room", themeLanguage: "en" },
  globals: {
    typeTokens: {
      heading: { family: "system-ui, sans-serif", weight: "600" },
      body: { family: "system-ui, sans-serif", weight: "400" },
      mono: { family: "monospace", weight: "400" },
    },
  },
  scene: { version: "7.4.0", objects: [] },
};

describe("parseThemePackage", () => {
  it("parses valid empty-asset packages", () => {
    const pkg = writeThemePackage({ envelope: validEnvelope, assets: {} });
    expect(pkg.ok).toBe(true);
    if (!pkg.ok) return;

    const result = parseThemePackage(pkg.bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.id).toBe("living-room");
    }
  });

  it("rejects corrupt bytes with a clear message", () => {
    const result = parseThemePackage(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
  });

  it("preserves each declared package asset", () => {
    const envelopeWithAssets: FabricThemeEnvelope = {
      ...validEnvelope,
      assets: [
        {
          id: "img1",
          kind: "image" as const,
          path: "assets/image.png",
        },
      ],
    };
    const pkg = writeThemePackage({
      envelope: envelopeWithAssets,
      assets: { "assets/image.png": new Uint8Array([1, 2, 3]) },
    });
    expect(pkg.ok).toBe(true);
    if (!pkg.ok) return;

    const result = parseThemePackage(pkg.bytes);
    expect(result).toMatchObject({ ok: true, envelope: envelopeWithAssets });
    if (result.ok)
      expect(result.assets["assets/image.png"]).toEqual(
        new Uint8Array([1, 2, 3]),
      );
  });

  it("hands back the picture a package carried, and nothing when it carried none", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
    ]);
    const withPicture = writeThemePackage({
      envelope: validEnvelope,
      assets: {},
      thumbnail: png,
    });
    expect(withPicture.ok).toBe(true);
    if (!withPicture.ok) return;

    const opened = parseThemePackage(withPicture.bytes);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.thumbnail).toEqual(png);

    const bare = writeThemePackage({ envelope: validEnvelope, assets: {} });
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    const bareParsed = parseThemePackage(bare.bytes);
    expect(bareParsed.ok).toBe(true);
    if (bareParsed.ok) expect(bareParsed.thumbnail).toBeUndefined();
  });
});

describe("serializeThemePackage", () => {
  it("serializes valid empty-asset envelopes into packages", () => {
    const result = serializeThemePackage(validEnvelope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = parseThemePackage(result.bytes);
      expect(parsed.ok).toBe(true);
    }
  });

  it("serializes assets with their declaration", () => {
    const envelope = {
      ...validEnvelope,
      assets: [
        {
          id: "img1",
          kind: "image" as const,
          path: "assets/test.png",
        },
      ],
    };
    const result = serializeThemePackage(envelope, {
      "assets/test.png": new Uint8Array([1, 2, 3]),
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("serializes the picture beside the theme, not as a declared asset", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
    ]);
    const result = serializeThemePackage(validEnvelope, {}, png);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = parseThemePackage(result.bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.thumbnail).toEqual(png);
    // A declared asset is one the renderer loads; a preview is not that.
    expect(parsed.envelope.assets ?? []).toEqual([]);
  });

  it("carries the credits collection through the package", () => {
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
    const result = serializeThemePackage(validEnvelope, {}, undefined, credits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = parseThemePackage(result.bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.credits).toEqual(credits);
  });
});

describe("fileNameFor", () => {
  it("uses the theme id with .yunari-theme extension", () => {
    expect(fileNameFor(validEnvelope)).toBe("living-room.yunari-theme");
  });

  it("falls back to theme.yunari-theme when id is not filename-safe", () => {
    expect(fileNameFor({ id: "../../etc/passwd" })).toBe("theme.yunari-theme");
  });
});
