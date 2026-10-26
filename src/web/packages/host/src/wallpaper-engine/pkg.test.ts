import { describe, expect, it } from "vitest";
import { memberBytes, mobilePackage, mobileVideo, readPackage } from "./pkg.js";

const encoder = new TextEncoder();

/**
 * One package as the format stores it: magic length, magic, entry count,
 * name/offset/length per entry, then the member bytes contiguous.
 */
function buildPackage(
  members: readonly (readonly [string, Uint8Array])[],
  magic = "PKGV0001",
): Uint8Array {
  const names = members.map(([name]) => encoder.encode(name));
  const namesSize = names.reduce(
    (total, name) => total + 4 + name.length + 8,
    0,
  );
  const dataSize = members.reduce((total, [, data]) => total + data.length, 0);
  const dataStart = 16 + namesSize;
  const out = new Uint8Array(dataStart + dataSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, 8, true);
  out.set(encoder.encode(magic), 4);
  view.setUint32(12, members.length, true);

  let cursor = 16;
  let offset = 0;
  members.forEach(([, data], index) => {
    const name = names[index]!;
    view.setUint32(cursor, name.length, true);
    cursor += 4;
    out.set(name, cursor);
    cursor += name.length;
    view.setUint32(cursor, offset, true);
    view.setUint32(cursor + 4, data.length, true);
    cursor += 8;
    offset += data.length;
  });

  let dataCursor = dataStart;
  for (const [, data] of members) {
    out.set(data, dataCursor);
    dataCursor += data.length;
  }

  return out;
}

const SCENE_JSON = encoder.encode('{"objects":[]}');
const THUMBNAIL = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("scene package container", () => {
  it("reads one member's name, offset, length and bytes", () => {
    const bytes = buildPackage([
      ["scene.json", SCENE_JSON],
      ["preview.jpg", THUMBNAIL],
    ]);

    const pkg = readPackage(bytes);

    expect(pkg).toBeDefined();
    expect(pkg?.dataStart).toBe(16 + (4 + 10 + 8) + (4 + 11 + 8));
    expect(pkg?.members.get("scene.json")).toEqual({
      name: "scene.json",
      offset: 0,
      length: SCENE_JSON.length,
    });
    expect(pkg?.members.get("preview.jpg")).toEqual({
      name: "preview.jpg",
      offset: SCENE_JSON.length,
      length: THUMBNAIL.length,
    });
    expect(memberBytes(pkg!, "preview.jpg")).toEqual(THUMBNAIL);
    expect(memberBytes(pkg!, "missing.json")).toBeUndefined();
  });

  it("refuses a truncated header", () => {
    const bytes = buildPackage([["scene.json", SCENE_JSON]]);

    expect(readPackage(bytes.subarray(0, 10))).toBeUndefined();
    expect(readPackage(bytes.subarray(0, 15))).toBeUndefined();
  });

  it("refuses a table whose last member runs past the file's end", () => {
    const bytes = buildPackage([["scene.json", SCENE_JSON]]);

    expect(readPackage(bytes.subarray(0, bytes.length - 1))).toBeUndefined();
  });

  it("refuses a zero-length name", () => {
    const bytes = buildPackage([["scene.json", SCENE_JSON]]);
    new DataView(bytes.buffer).setUint32(16, 0, true);

    expect(readPackage(bytes)).toBeUndefined();
  });

  it("refuses a magic that is not a Wallpaper Engine package", () => {
    const bytes = buildPackage([["scene.json", SCENE_JSON]]);
    bytes.set(encoder.encode("XKGV0001"), 4);

    expect(readPackage(bytes)).toBeUndefined();
  });

  it("refuses a zero magic length", () => {
    const bytes = buildPackage([["scene.json", SCENE_JSON]]);
    new DataView(bytes.buffer).setUint32(0, 0, true);

    expect(readPackage(bytes)).toBeUndefined();
  });

  it("refuses a name that repeats an earlier one", () => {
    const bytes = buildPackage([
      ["scene.json", SCENE_JSON],
      ["scene.json", THUMBNAIL],
    ]);

    expect(readPackage(bytes)).toBeUndefined();
  });
});

describe("mobile package", () => {
  const VIDEO = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  ]);

  it("reads the video out of a PKGM export", () => {
    const bytes = buildPackage(
      [
        ["nopreview.jpg", THUMBNAIL],
        ["project.json", encoder.encode("{}")],
        ["wallpaper.mp4", VIDEO],
      ],
      "PKGM0014",
    );

    expect(mobileVideo(bytes)).toEqual(VIDEO);
  });

  it("answers nothing for a mobile package with no video", () => {
    const bytes = buildPackage(
      [["project.json", encoder.encode("{}")]],
      "PKGM0014",
    );

    expect(mobileVideo(bytes)).toBeUndefined();
  });

  it("answers nothing for something that is not a package", () => {
    expect(mobileVideo(encoder.encode("not a package"))).toBeUndefined();
  });
});

describe("mobile package import", () => {
  const VIDEO = encoder.encode("mp4");
  const PROJECT = encoder.encode(
    JSON.stringify({
      title: "Aurora",
      package: { workshopId: 12345 },
    }),
  );

  it("answers the video with the metadata project.json carries", () => {
    const bytes = buildPackage(
      [
        ["project.json", PROJECT],
        ["wallpaper.mp4", VIDEO],
      ],
      "PKGM0014",
    );

    expect(mobilePackage(bytes)).toEqual({
      video: VIDEO,
      title: "Aurora",
      workshopId: "12345",
    });
  });

  it("answers nothing for a table with no video", () => {
    const bytes = buildPackage([["project.json", PROJECT]], "PKGM0014");

    expect(mobilePackage(bytes)).toBeUndefined();
  });

  it("still answers the video when project.json does not parse", () => {
    const bytes = buildPackage(
      [
        ["project.json", encoder.encode("{ not json")],
        ["wallpaper.mp4", VIDEO],
      ],
      "PKGM0014",
    );

    expect(mobilePackage(bytes)).toEqual({ video: VIDEO });
  });
});
