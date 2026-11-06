import { describe, expect, it, vi } from "vitest";

/**
 * The loaded/unloaded contract, against a fresh module instance.
 *
 * The global vitest setup loads the starter for the suites that open a
 * document. `vi.resetModules()` plus a dynamic import gives this file its own
 * instance, so the refusal before loading is exercised rather than assumed.
 */
async function freshModule(): Promise<typeof import("./starter.js")> {
  vi.resetModules();
  return await import("./starter.js");
}

function garbageFetcher(): typeof fetch {
  return (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
}

describe("the bundled starter module", () => {
  it("refuses to hand out the document before it is loaded", async () => {
    const module_ = await freshModule();

    expect(() => module_.bundledStarterEnvelope()).toThrow(
      /has not been loaded/,
    );
    expect(() => module_.bundledStarterAssets()).toThrow(/has not been loaded/);
  });

  it("reports a malformed package clearly, and stays unloaded", async () => {
    const module_ = await freshModule();

    await expect(module_.loadBundledStarter(garbageFetcher())).rejects.toThrow(
      /^The bundled starter template is not readable:/,
    );
    expect(() => module_.bundledStarterEnvelope()).toThrow(
      /has not been loaded/,
    );
  });
});
