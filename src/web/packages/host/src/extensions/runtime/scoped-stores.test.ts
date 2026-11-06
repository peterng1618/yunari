import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InstalledPlugin } from "@yunari/extension-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeyProtectorUnavailable } from "../../settings/secret-store.js";
import { createScopedStores } from "./scoped-stores.js";

const MiB = 1024 * 1024;
const SETTINGS_CAP = 64 * 1024;

function plugin(): InstalledPlugin {
  return {
    key: "acme/test-plugin",
    publisher: "acme",
    directory: "/plugins/acme/test-plugin/1.0.0",
    contentHash: "a".repeat(64),
    manifest: {
      manifestVersion: 1,
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "fixture",
      engines: { yunari: ">=0.1.0" },
      pluginApi: 1,
      execution: "trusted-worker",
      capabilities: [],
      contributes: {},
    },
  };
}

describe("scoped stores", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "yunari-scoped-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("storage", () => {
    it("round-trips values and lists keys in sorted order", async () => {
      const stores = createScopedStores(root, plugin());

      await stores.storage.set("b", "two");
      await stores.storage.set("a", "one");

      expect(await stores.storage.get("a")).toBe("one");
      expect(await stores.storage.get("absent")).toBeUndefined();
      expect(await stores.storage.list()).toEqual(["a", "b"]);
    });

    it("removes a key and treats a missing one as a no-op", async () => {
      const stores = createScopedStores(root, plugin());

      await stores.storage.set("a", "one");
      await stores.storage.remove("a");
      await stores.storage.remove("a");

      expect(await stores.storage.get("a")).toBeUndefined();
      expect(await stores.storage.list()).toEqual([]);
    });

    it("refuses a key that would steer a path or a device name", async () => {
      const stores = createScopedStores(root, plugin());

      for (const key of [
        "../escape",
        "a/b",
        "a\\b",
        "",
        ".",
        "..",
        "x".repeat(129),
      ]) {
        await expect(stores.storage.set(key, "x"), key).rejects.toThrow(
          "not a storage key",
        );
      }

      // `CON` is a device name on Windows; the encoded file name is not.
      await stores.storage.set("CON", "x");
      expect(await stores.storage.get("CON")).toBe("x");
    });

    it("refuses a value larger than 1 MiB", async () => {
      const stores = createScopedStores(root, plugin());

      await expect(
        stores.storage.set("big", "a".repeat(MiB + 1)),
      ).rejects.toThrow(/1 MiB|1048576/);
    });

    it("refuses a 1,001st key", async () => {
      const stores = createScopedStores(root, plugin());

      for (let index = 0; index < 1000; index += 1) {
        await stores.storage.set(`k${index}`, "");
      }

      await expect(stores.storage.set("overflow", "")).rejects.toThrow(/1000/);
    }, 60_000);
  });

  describe("secrets", () => {
    it("refuses a key outside the storage grammar before encrypting", async () => {
      const stores = createScopedStores(root, plugin());

      await expect(stores.secrets.set("../x", "v")).rejects.toThrow(
        "not a storage key",
      );
      await expect(stores.secrets.get("a/b")).rejects.toThrow(
        "not a storage key",
      );
    });

    it("round-trips a UTF-8 secret when the OS protector is available", async (ctx) => {
      const stores = createScopedStores(root, plugin());

      try {
        await stores.secrets.set("token", "sëcret");
      } catch (error) {
        if (error instanceof KeyProtectorUnavailable) {
          ctx.skip();
          return;
        }
        throw error;
      }

      expect(await stores.secrets.get("token")).toBe("sëcret");
      await stores.secrets.remove("token");
      expect(await stores.secrets.get("token")).toBeUndefined();
    });

    it("refuses a secret larger than 1 MiB", async () => {
      const stores = createScopedStores(root, plugin());

      await expect(
        stores.secrets.set("big", "a".repeat(MiB + 1)),
      ).rejects.toThrow(/1 MiB|1048576/);
    });
  });

  describe("settings", () => {
    it("reads as an empty object before anything is stored", async () => {
      const stores = createScopedStores(root, plugin());

      expect(await stores.settings.get()).toEqual({});
    });

    it("replaces the whole settings object", async () => {
      const stores = createScopedStores(root, plugin());

      await stores.settings.set({ theme: "dark" });
      expect(await stores.settings.get()).toEqual({ theme: "dark" });

      await stores.settings.set({ density: 2 });
      expect(await stores.settings.get()).toEqual({ density: 2 });
    });

    it("refuses a non-object and a write larger than 64 KiB", async () => {
      const stores = createScopedStores(root, plugin());

      await expect(
        stores.settings.set([] as unknown as Record<string, unknown>),
      ).rejects.toThrow(/object/i);
      await expect(
        stores.settings.set({ text: "a".repeat(SETTINGS_CAP) }),
      ).rejects.toThrow(/65536|64 KiB/);
    });
  });
});
