import { describe, expect, it } from "vitest";
import { readSceneFacts } from "./classify.js";

const encoder = new TextEncoder();

/** The same hand-built container as `pkg.test.ts`, holding named members. */
function buildPackage(
  members: readonly (readonly [string, string])[],
): Uint8Array {
  const entries = members.map(
    ([name, body]) => [encoder.encode(name), encoder.encode(body)] as const,
  );
  const namesSize = entries.reduce(
    (total, [name]) => total + 4 + name.length + 8,
    0,
  );
  const dataSize = entries.reduce((total, [, data]) => total + data.length, 0);
  const dataStart = 16 + namesSize;
  const out = new Uint8Array(dataStart + dataSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, 8, true);
  out.set(encoder.encode("PKGV0001"), 4);
  view.setUint32(12, entries.length, true);

  let cursor = 16;
  let offset = 0;
  for (const [name, data] of entries) {
    view.setUint32(cursor, name.length, true);
    cursor += 4;
    out.set(name, cursor);
    cursor += name.length;
    view.setUint32(cursor, offset, true);
    view.setUint32(cursor + 4, data.length, true);
    cursor += 8;
    offset += data.length;
  }

  let dataCursor = dataStart;
  for (const [, data] of entries) {
    out.set(data, dataCursor);
    dataCursor += data.length;
  }

  return out;
}

const scene = (objects: readonly unknown[]): string =>
  JSON.stringify({ objects });

describe("still-at-rest test", () => {
  it("keeps a scene with image, text, sound, parallax and led content at rest", () => {
    const bytes = buildPackage([
      [
        "scene.json",
        scene([
          { image: "background.jpg", origin: [0, 0, 0], scale: [1, 1, 1] },
          { text: "12:00", origin: [100, 100, 0] },
          { sound: ["music.mp3"] },
          { parallaxDepth: [0.1, 0.1], image: "parallax.png" },
          { ledsource: { bounds: [0, 0, 10, 10] } },
        ]),
      ],
    ]);

    expect(readSceneFacts(bytes)).toEqual({ atRest: true, hasText: true });
  });

  it("refuses a particle system", () => {
    const bytes = buildPackage([
      ["scene.json", scene([{ particle: "particles/one.json" }])],
    ]);

    expect(readSceneFacts(bytes)).toEqual({ atRest: false, hasText: false });
  });

  it("refuses animation layers", () => {
    const bytes = buildPackage([
      ["scene.json", scene([{ animationlayers: [{ name: "layer0" }] }])],
    ]);

    expect(readSceneFacts(bytes)).toEqual({ atRest: false, hasText: false });
  });

  it("refuses a keyframed property nested under an object", () => {
    const bytes = buildPackage([
      [
        "scene.json",
        scene([
          {
            image: "background.jpg",
            origin: {
              animation: { c0: [{ frame: 0, value: 0 }] },
            },
          },
        ]),
      ],
    ]);

    expect(readSceneFacts(bytes)).toEqual({ atRest: false, hasText: false });
  });

  it("refuses a keyframe inside a sound object", () => {
    const bytes = buildPackage([
      [
        "scene.json",
        scene([
          {
            sound: ["music.mp3"],
            volume: { animation: { c0: [{ frame: 0, value: 0 }] } },
          },
        ]),
      ],
    ]);

    expect(readSceneFacts(bytes)).toEqual({ atRest: false, hasText: false });
  });

  it("returns undefined when the package has no scene.json", () => {
    const bytes = buildPackage([["preview.jpg", "not a scene"]]);

    expect(readSceneFacts(bytes)).toBeUndefined();
  });

  it("returns undefined when scene.json has no objects array", () => {
    const bytes = buildPackage([
      ["scene.json", JSON.stringify({ general: {} })],
    ]);

    expect(readSceneFacts(bytes)).toBeUndefined();
  });

  it("refuses a scene whose model carries animation", () => {
    const bytes = buildPackage([
      ["scene.json", scene([{ model: "models/x.json" }])],
      ["models/x.json", JSON.stringify({ animation: { c0: [{ frame: 0 }] } })],
    ]);

    expect(readSceneFacts(bytes)).toEqual({ atRest: false, hasText: false });
  });

  it("keeps a scene whose model is static", () => {
    const bytes = buildPackage([
      ["scene.json", scene([{ model: "models/x.json" }])],
      ["models/x.json", JSON.stringify({ material: "materials/x.json" })],
    ]);

    expect(readSceneFacts(bytes)).toEqual({ atRest: true, hasText: false });
  });

  it("refuses to classify a scene whose model member is absent", () => {
    const bytes = buildPackage([
      ["scene.json", scene([{ model: "models/x.json" }])],
    ]);

    expect(readSceneFacts(bytes)).toBeUndefined();
  });

  it("refuses to classify a scene whose model member does not parse", () => {
    const bytes = buildPackage([
      ["scene.json", scene([{ model: "models/x.json" }])],
      ["models/x.json", "{ not json"],
    ]);

    expect(readSceneFacts(bytes)).toBeUndefined();
  });
});
