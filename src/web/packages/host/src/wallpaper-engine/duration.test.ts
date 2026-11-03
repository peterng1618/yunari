import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { videoDurationMs } from "./duration.js";

const conformingMp4 = fileURLToPath(
  new URL(
    "../../../theme-package/test-fixtures/conforming.mp4",
    import.meta.url,
  ),
);

describe("videoDurationMs", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-duration-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("reads a real container's length without loading the whole file", async () => {
    expect(await videoDurationMs(conformingMp4)).toBe(2000);
  });

  it("answers nothing for a file that is not a movie", async () => {
    const file = path.join(tmp, "clip.mp4");
    await fs.writeFile(file, "not a movie");

    expect(await videoDurationMs(file)).toBeUndefined();
  });

  it("answers nothing for a missing or empty file", async () => {
    expect(await videoDurationMs(path.join(tmp, "absent.mp4"))).toBeUndefined();

    const empty = path.join(tmp, "empty.mp4");
    await fs.writeFile(empty, "");

    expect(await videoDurationMs(empty)).toBeUndefined();
  });
});
