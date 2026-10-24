import {
  DEFAULT_UNIT_PREFERENCES,
  type FabricThemeEnvelope,
} from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import {
  loadDisplayPreferences,
  loadHostedFontAssets,
  loadHostedTheme,
} from "./theme-loader.js";

const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "living-room",
  artboard: { width: 1920, height: 1080 },
  metadata: { themeLanguage: "en" },
  scene: { version: "7.4.0", objects: [] },
};

describe("loadDisplayPreferences", () => {
  it("reads the host's unit preferences, resting on the defaults", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ settings: { units: { clock: "ghz", data: "decimal" } } }),
    );

    await expect(loadDisplayPreferences(fetcher)).resolves.toEqual({
      ...DEFAULT_UNIT_PREFERENCES,
      clock: "ghz",
      data: "decimal",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/display");
  });

  it("uses every default when the host stores no units", async () => {
    await expect(
      loadDisplayPreferences(async () => Response.json({ settings: {} })),
    ).resolves.toEqual(DEFAULT_UNIT_PREFERENCES);
  });

  it("keeps the older measurement field as the temperature preference", async () => {
    await expect(
      loadDisplayPreferences(async () =>
        Response.json({ settings: { measurement: "imperial" } }),
      ),
    ).resolves.toEqual({
      ...DEFAULT_UNIT_PREFERENCES,
      measurement: "imperial",
    });
  });

  it("uses every default when a stored preference cannot be displayed", async () => {
    await expect(
      loadDisplayPreferences(async () =>
        Response.json({ settings: { units: { clock: "thz" } } }),
      ),
    ).resolves.toEqual(DEFAULT_UNIT_PREFERENCES);
  });

  it("uses every default when the host cannot answer", async () => {
    await expect(
      loadDisplayPreferences(async () => new Response("", { status: 404 })),
    ).resolves.toEqual(DEFAULT_UNIT_PREFERENCES);
    await expect(
      loadDisplayPreferences(async () => {
        throw new Error("down");
      }),
    ).resolves.toEqual(DEFAULT_UNIT_PREFERENCES);
  });
});

describe("loadHostedTheme", () => {
  it("rejects invalid IDs before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(loadHostedTheme("../escape", fetcher)).rejects.toThrow(
      "Invalid theme id.",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an unsuccessful host response", async () => {
    await expect(
      loadHostedTheme(
        "living-room",
        async () => new Response("", { status: 404 }),
      ),
    ).rejects.toThrow("404");
  });

  it("loads a validated hosted envelope, named by its own id", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(envelope));

    // The fixture carries no name, and the loader names what it finds unnamed
    // (`vg-221`): the published schema refuses an empty `metadata.name`, so a
    // document read through here gains the id it is already identified by.
    await expect(loadHostedTheme("living-room", fetcher)).resolves.toEqual({
      ...envelope,
      metadata: { themeLanguage: "en", name: "living-room" },
    });
    expect(fetcher).toHaveBeenCalledWith("/api/themes/living-room/document");
  });

  it("rejects an invalid hosted envelope", async () => {
    await expect(
      loadHostedTheme("living-room", async () =>
        Response.json({ ...envelope, schemaVersion: "3.0.0" }),
      ),
    ).rejects.toThrow("newer version");
  });

  it("fetches exact bytes for declared font assets only", async () => {
    const theme: FabricThemeEnvelope = {
      ...envelope,
      assets: [
        { id: "inter-400", kind: "font", path: "assets/inter-400.woff2" },
        { id: "logo", kind: "image", path: "assets/logo.png" },
      ],
    };
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array([1, 2])),
    );

    await expect(
      loadHostedFontAssets("living-room", theme, fetcher),
    ).resolves.toEqual({ "assets/inter-400.woff2": new Uint8Array([1, 2]) });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/themes/living-room/assets/inter-400.woff2",
    );
  });

  it("rejects a failed declared font fetch", async () => {
    const theme: FabricThemeEnvelope = {
      ...envelope,
      assets: [
        { id: "inter-400", kind: "font", path: "assets/inter-400.woff2" },
      ],
    };

    await expect(
      loadHostedFontAssets(
        "living-room",
        theme,
        async () => new Response("", { status: 404 }),
      ),
    ).rejects.toThrow("font asset");
  });
});
