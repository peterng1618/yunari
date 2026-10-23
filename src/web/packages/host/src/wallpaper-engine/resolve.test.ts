import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LibraryItem } from "./library.js";
import { IMAGE_EXTENSIONS, resolvePayload } from "./resolve.js";

/** An item whose payload path is `directory/file`; nothing else is read. */
function itemAt(
  directory: string,
  file: string,
  type: LibraryItem["type"],
): LibraryItem {
  return {
    workshopId: "101",
    directory,
    title: "An item",
    payload: path.join(directory, file),
    type,
    preview: undefined,
    filesize: 1,
    tags: [],
    authorSteamId: undefined,
    workshopUrl: undefined,
    properties: undefined,
  };
}

describe("resolving an item to its outcome (§4)", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-resolve-"));
    for (const name of [
      "pic.jpg",
      "pic.PNG",
      "clip.mp4",
      "clip.wmv",
      "index.html",
      "scene.pkg",
    ]) {
      await fs.writeFile(path.join(directory, name), "x");
    }
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("calls an image extension an image before it looks at the type", async () => {
    expect(IMAGE_EXTENSIONS).toContain(".webp");

    expect(await resolvePayload(itemAt(directory, "pic.jpg", "video"))).toEqual(
      {
        kind: "image",
        path: path.join(directory, "pic.jpg"),
        contentType: "image/jpeg",
      },
    );
  });

  it("matches an image extension in any casing", async () => {
    expect(await resolvePayload(itemAt(directory, "pic.PNG", "scene"))).toEqual(
      {
        kind: "image",
        path: path.join(directory, "pic.PNG"),
        contentType: "image/png",
      },
    );
  });

  it("resolves a video and its content type", async () => {
    expect(
      await resolvePayload(itemAt(directory, "clip.mp4", "video")),
    ).toEqual({
      kind: "video",
      path: path.join(directory, "clip.mp4"),
      contentType: "video/mp4",
    });
    expect(
      await resolvePayload(itemAt(directory, "clip.wmv", "video")),
    ).toEqual({
      kind: "video",
      path: path.join(directory, "clip.wmv"),
      contentType: "video/x-ms-wmv",
    });
  });

  it("resolves a web item without a path to serve", async () => {
    expect(
      await resolvePayload(itemAt(directory, "index.html", "web")),
    ).toEqual({
      kind: "web",
    });
  });

  it("resolves a scene to its package", async () => {
    expect(
      await resolvePayload(itemAt(directory, "scene.pkg", "scene")),
    ).toEqual({ kind: "scene", path: path.join(directory, "scene.pkg") });
  });

  it("refuses a payload that is not on disk, whatever the type", async () => {
    expect(
      await resolvePayload(itemAt(directory, "missing.pkg", "scene")),
    ).toBeUndefined();
    expect(
      await resolvePayload(itemAt(directory, "missing.jpg", "web")),
    ).toBeUndefined();
  });

  it("refuses a descriptor whose payload leaves the item's directory", async () => {
    const nested = path.join(directory, "nested");
    await fs.mkdir(nested, { recursive: true });

    // `nested/../pic.jpg` is a file that exists, but it is not this item's.
    expect(
      await resolvePayload(itemAt(nested, "../pic.jpg", "video")),
    ).toBeUndefined();
  });
});
