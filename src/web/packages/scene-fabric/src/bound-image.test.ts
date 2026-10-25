// @vitest-environment jsdom
import type { Binding, Sample, SampleSource } from "@yunari/renderer-core";
import { FabricImage } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import {
  type ImageBindingHooks,
  isHostRelativeImageUrl,
  refreshBoundImages,
} from "./bound-image.js";

/**
 * An image reading is a URL, and the one rule that makes it safe is that the
 * URL is host-relative: anything else would let a sample point a display at an
 * origin of its choosing.
 *
 * jsdom never decodes an image, so the pass's own `<img>` elements are captured
 * and their `load` fired by hand. That is the same event the browser fires; what
 * a real decode means is proved by `tests/e2e/image-binding.spec.ts`.
 */

const NODE_ID = "artwork";
const BINDING: Binding = { id: "image", semanticKey: "media.artwork" };

function sourceOf(sample: Sample | undefined): SampleSource {
  return { revision: 0, latest: () => sample, history: () => [] };
}

function sample(textValue: string | undefined): Sample {
  return {
    sensorId: "media.artwork",
    timestamp: new Date(0).toISOString(),
    status: "ok",
    ...(textValue === undefined ? {} : { textValue }),
  };
}

/** An image revived with the authored source, the way the player mounts one. */
function authoredImage(src: string, id = NODE_ID): FabricImage {
  const element = document.createElement("img");
  element.src = src;
  const image = new FabricImage(element);
  image.set("id", id);
  return image;
}

/** The pass's own `<img>` elements, captured before any spy replaces the factory. */
const createElement = document.createElement.bind(document);

/** Every `<img>` the pass creates after this call, in order. */
function capturedElements(): HTMLImageElement[] {
  const created: HTMLImageElement[] = [];
  vi.spyOn(document, "createElement").mockImplementation(((
    name: string,
    options?: ElementCreationOptions,
  ) => {
    const element = createElement(name, options);
    if (name === "img") created.push(element as HTMLImageElement);
    return element;
  }) as typeof document.createElement);
  return created;
}

/** Fire the decode a browser would, so the pass swaps its source. */
function decoded(element: HTMLImageElement | undefined): void {
  if (element === undefined) throw new Error("no image element was created");
  element.dispatchEvent(new Event("load"));
}

function hooks(resolve = () => "/api/media/live.png"): ImageBindingHooks {
  return { resolve };
}

describe("isHostRelativeImageUrl", () => {
  it("accepts a path on the host and refuses everything else", () => {
    expect(isHostRelativeImageUrl("/api/media/artwork/a.png")).toBe(true);
    expect(isHostRelativeImageUrl("https://x/a.png")).toBe(false);
    expect(isHostRelativeImageUrl("//x/a.png")).toBe(false);
    expect(isHostRelativeImageUrl("data:image/png;base64,AA")).toBe(false);
    expect(isHostRelativeImageUrl("a.png")).toBe(false);
    // URL parsing reads the backslash as `/`, so this is an authority.
    expect(isHostRelativeImageUrl("/\\evil.example/a.png")).toBe(false);
    // The parser strips tab and newline before it reads the authority, so a
    // path first character cannot be trusted over the rest of the string.
    expect(isHostRelativeImageUrl("/\n/evil.example/a.png")).toBe(false);
    expect(isHostRelativeImageUrl("/\t/evil.example/a.png")).toBe(false);
  });
});

describe("refreshBoundImages", () => {
  it("loads the reading's resolved URL instead of the authored asset", () => {
    const image = authoredImage("/assets/authored.png");
    const created = capturedElements();

    refreshBoundImages(
      [image],
      { [NODE_ID]: [BINDING] },
      sourceOf(sample("/api/media/live.png")),
      hooks(),
    );

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe("http://localhost:3000/api/media/live.png");
    decoded(created[0]);
    expect(image.getSrc()).toBe("http://localhost:3000/api/media/live.png");
  });

  it("leaves the authored src and reports a reading that is not host-relative", () => {
    const image = authoredImage("/assets/authored.png");
    const created = capturedElements();
    const onRefused = vi.fn();

    refreshBoundImages(
      [image],
      { [NODE_ID]: [BINDING] },
      sourceOf(sample("https://evil.example/a.png")),
      { ...hooks(), onRefused },
    );

    expect(created).toHaveLength(0);
    expect(image.getSrc()).toMatch(/\/assets\/authored\.png$/);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalledWith(NODE_ID, expect.any(String));
  });

  it("restores the authored src when the reading turns unavailable", () => {
    const image = authoredImage("/assets/authored.png");
    const bindings = { [NODE_ID]: [BINDING] };

    const live = capturedElements();
    refreshBoundImages(
      [image],
      bindings,
      sourceOf(sample("/api/media/live.png")),
      hooks(),
    );
    decoded(live[0]);
    expect(image.getSrc()).toMatch(/\/api\/media\/live\.png$/);

    const restored = capturedElements();
    refreshBoundImages(
      [image],
      bindings,
      sourceOf({
        sensorId: "media.artwork",
        timestamp: new Date(0).toISOString(),
        status: "unavailable",
      }),
      hooks(),
    );
    decoded(restored[0]);
    expect(image.getSrc()).toMatch(/\/assets\/authored\.png$/);
  });

  it("restores the authored src when the reading fails", () => {
    const image = authoredImage("/assets/authored.png");
    const bindings = { [NODE_ID]: [BINDING] };

    const live = capturedElements();
    refreshBoundImages(
      [image],
      bindings,
      sourceOf(sample("/api/media/live.png")),
      hooks(),
    );
    decoded(live[0]);
    expect(image.getSrc()).toMatch(/\/api\/media\/live\.png$/);

    const restored = capturedElements();
    refreshBoundImages(
      [image],
      bindings,
      sourceOf({
        sensorId: "media.artwork",
        timestamp: new Date(0).toISOString(),
        status: "error",
      }),
      hooks(),
    );
    decoded(restored[0]);
    expect(image.getSrc()).toMatch(/\/assets\/authored\.png$/);
  });

  it("keeps the newest reading when an older load lands last", () => {
    const image = authoredImage("/assets/authored.png");
    const bindings = { [NODE_ID]: [BINDING] };
    const created = capturedElements();
    const identity = (url: string): string => url;

    // Neither load has settled; the second reading is applied while the first
    // is still in flight, which is the race the generations exist for.
    refreshBoundImages(
      [image],
      bindings,
      sourceOf(sample("/api/media/a.png")),
      { resolve: identity },
    );
    refreshBoundImages(
      [image],
      bindings,
      sourceOf(sample("/api/media/b.png")),
      { resolve: identity },
    );
    expect(created).toHaveLength(2);

    decoded(created[1]);
    decoded(created[0]);
    expect(image.getSrc()).toBe("http://localhost:3000/api/media/b.png");
  });

  it("does not let a stale load overwrite the restored authored src", () => {
    const image = authoredImage("/assets/authored.png");
    const bindings = { [NODE_ID]: [BINDING] };
    const created = capturedElements();
    const identity = (url: string): string => url;

    // The live load is still in flight when the reading turns unavailable.
    refreshBoundImages(
      [image],
      bindings,
      sourceOf(sample("/api/media/live.png")),
      { resolve: identity },
    );
    refreshBoundImages(
      [image],
      bindings,
      sourceOf({
        sensorId: "media.artwork",
        timestamp: new Date(0).toISOString(),
        status: "unavailable",
      }),
      { resolve: identity },
    );
    expect(created).toHaveLength(2);

    decoded(created[1]);
    decoded(created[0]);
    expect(image.getSrc()).toMatch(/\/assets\/authored\.png$/);
  });

  it("leaves the authored asset when no reading has arrived", () => {
    const image = authoredImage("/assets/authored.png");
    const created = capturedElements();

    refreshBoundImages(
      [image],
      { [NODE_ID]: [BINDING] },
      sourceOf(undefined),
      hooks(),
    );

    expect(created).toHaveLength(0);
    expect(image.getSrc()).toMatch(/\/assets\/authored\.png$/);
  });

  it("does not touch an image with no image-capable binding", () => {
    const image = authoredImage("/assets/authored.png");
    const created = capturedElements();

    refreshBoundImages(
      [image],
      {},
      sourceOf(sample("/api/media/live.png")),
      hooks(),
    );

    expect(created).toHaveLength(0);
    expect(image.getSrc()).toMatch(/\/assets\/authored\.png$/);
  });

  it("does not touch an image bound to a non-image reading", () => {
    const image = authoredImage("/assets/authored.png");
    const created = capturedElements();

    // A sample with a URL-shaped `textValue` is not evidence that the binding
    // it arrived through is an image binding.
    refreshBoundImages(
      [image],
      { [NODE_ID]: [{ id: "value", semanticKey: "cpu.load" }] },
      sourceOf(sample("/api/media/live.png")),
      hooks(),
    );

    expect(created).toHaveLength(0);
    expect(image.getSrc()).toMatch(/\/assets\/authored\.png$/);
  });
});
