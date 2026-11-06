import { describe, expect, it } from "vitest";
import {
  BUILTIN_PATH_PRESETS,
  readPathPresetPack,
} from "./path-preset-pack.js";

function pack(overrides: Record<string, unknown> = {}): unknown {
  return {
    format: "yunari-path-preset-pack",
    version: 1,
    id: "acme",
    name: "Acme shapes",
    presets: [
      { id: "wave", label: "Wave", data: "M 0 0 L 10 10 Z", paint: "fill" },
    ],
    ...overrides,
  };
}

function refusal(value: unknown): string {
  const result = readPathPresetPack(value);
  if (result.ok) throw new Error("expected the pack to be refused");
  return result.message;
}

describe("the built-in path presets", () => {
  it("are the three shipped shapes, with their own data and paint", () => {
    expect(BUILTIN_PATH_PRESETS).toEqual([
      {
        id: "line",
        label: "Horizontal line",
        data: "M 0 100 L 360 100",
        paint: "stroke",
      },
      {
        id: "arc",
        label: "Arc",
        data: "M 200 0 A 200 200 0 0 1 0 200",
        paint: "stroke",
      },
      {
        id: "wedge",
        label: "Wedge",
        data: "M 0 0 L 200 0 A 200 200 0 0 1 0 200 Z",
        paint: "fill",
      },
    ]);
  });
});

describe("reading a path preset pack", () => {
  it("accepts the declared format and trims every authored string", () => {
    const result = readPathPresetPack(
      pack({
        id: " acme ",
        name: " Acme shapes ",
        presets: [
          {
            id: " wave ",
            label: " Wave ",
            data: " M 0 0 L 10 10 Z ",
            paint: "fill",
          },
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      pack: {
        format: "yunari-path-preset-pack",
        version: 1,
        id: "acme",
        name: "Acme shapes",
        presets: [
          { id: "wave", label: "Wave", data: "M 0 0 L 10 10 Z", paint: "fill" },
        ],
      },
    });
  });

  it.each([
    ["another format", pack({ format: "yunari-widget-package" })],
    ["another version", pack({ version: 2 })],
    ["a blank id", pack({ id: "   " })],
    ["a blank name", pack({ name: "   " })],
    ["a presets value that is not a list", pack({ presets: {} })],
    [
      "a preset that is not an object",
      pack({ presets: [{ id: "wave" }, null, "x"] }),
    ],
    [
      "a blank preset id",
      pack({
        presets: [
          { id: " ", label: "Wave", data: "M 0 0 L 1 1", paint: "stroke" },
        ],
      }),
    ],
    [
      "a blank preset label",
      pack({
        presets: [
          { id: "wave", label: " ", data: "M 0 0 L 1 1", paint: "stroke" },
        ],
      }),
    ],
    [
      "blank preset data",
      pack({
        presets: [{ id: "wave", label: "Wave", data: " ", paint: "stroke" }],
      }),
    ],
    [
      "a paint that is neither stroke nor fill",
      pack({
        presets: [
          { id: "wave", label: "Wave", data: "M 0 0 L 1 1", paint: "both" },
        ],
      }),
    ],
    [
      "two presets with one id",
      pack({
        presets: [
          { id: "wave", label: "Wave", data: "M 0 0 L 1 1", paint: "stroke" },
          { id: "wave", label: "Again", data: "M 0 0 L 2 2", paint: "stroke" },
        ],
      }),
    ],
  ])("refuses %s", (_name, value) => {
    expect(refusal(value)).not.toBe("");
  });

  it("refuses more than a thousand presets", () => {
    const presets = Array.from({ length: 1001 }, (_unused, index) => ({
      id: `shape-${index}`,
      label: `Shape ${index}`,
      data: "M 0 0 L 1 1",
      paint: "stroke",
    }));

    expect(refusal(pack({ presets }))).toMatch(/1000|too many/i);
  });

  it("refuses a pack whose id or name is over the character bound", () => {
    expect(refusal(pack({ id: "a".repeat(201) }))).not.toBe("");
    expect(refusal(pack({ name: "a".repeat(201) }))).not.toBe("");
  });

  it("refuses a preset field over its own bound", () => {
    expect(
      refusal(
        pack({
          presets: [
            {
              id: "a".repeat(201),
              label: "Wave",
              data: "M 0 0 L 1 1",
              paint: "stroke",
            },
          ],
        }),
      ),
    ).not.toBe("");
    expect(
      refusal(
        pack({
          presets: [
            {
              id: "wave",
              label: "a".repeat(201),
              data: "M 0 0 L 1 1",
              paint: "stroke",
            },
          ],
        }),
      ),
    ).not.toBe("");
    expect(
      refusal(
        pack({
          presets: [
            {
              id: "wave",
              label: "Wave",
              data: "a".repeat(200_001),
              paint: "stroke",
            },
          ],
        }),
      ),
    ).not.toBe("");
  });

  it("refuses a value that is not an object", () => {
    expect(refusal(null)).not.toBe("");
    expect(refusal([])).not.toBe("");
    expect(refusal("pack")).not.toBe("");
  });
});
