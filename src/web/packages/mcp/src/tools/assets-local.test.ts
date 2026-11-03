import { describe, expect, it, vi } from "vitest";
import { InMemoryDraftStore } from "../drafts.js";
import { HttpHostClient } from "../host-client.js";
import { startFakeHost } from "../testing/fake-host.js";
import type { ToolContext } from "../types.js";
import { importAsset } from "./assets.js";
import { createTheme } from "./draft.js";

// The local import must refuse an unsupported extension and an over-cap file
// before it reads them: a prompt-injected path must not be loaded to find out.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const { MAX_ASSET_BYTES } = await import("@yunari/theme-kit");
  return {
    ...actual,
    stat: vi.fn(async () => ({
      isFile: () => true,
      size: MAX_ASSET_BYTES + 1,
    })),
    readFile: vi.fn(async () => {
      throw new Error("readFile must not run");
    }),
  };
});

describe("local asset import refusal order", () => {
  it("refuses an over-cap file without reading it", async () => {
    const host = await startFakeHost(() => undefined);
    const context: ToolContext = {
      host: new HttpHostClient(host.url),
      drafts: new InMemoryDraftStore(),
    };
    await createTheme(context, { name: "Mine", width: 800, height: 480 });

    const result = await importAsset(context, {
      path: "C:/tmp/huge.png",
      license: "MIT",
    });

    expect(result.isError).toBe(true);
    const block = result.content[0];
    expect(block?.type === "text" ? block.text : "").toMatch(/asset cap/u);
    expect(block?.type === "text" ? block.text : "").not.toContain(
      "readFile must not run",
    );
    await host.close();
  });

  it("refuses an unsupported extension before stat", async () => {
    const host = await startFakeHost(() => undefined);
    const context: ToolContext = {
      host: new HttpHostClient(host.url),
      drafts: new InMemoryDraftStore(),
    };
    await createTheme(context, { name: "Mine", width: 800, height: 480 });

    const result = await importAsset(context, {
      path: "C:/tmp/huge.exe",
      license: "MIT",
    });

    expect(result.isError).toBe(true);
    const block = result.content[0];
    expect(block?.type === "text" ? block.text : "").toMatch(
      /image, video or font/u,
    );
    await host.close();
  });
});
