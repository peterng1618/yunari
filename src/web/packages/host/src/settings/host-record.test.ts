import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_ID_PATTERN } from "./devices.js";
import { readOrMintHostRecord } from "./host-record.js";

const FILE = "host-identity.json";

describe("readOrMintHostRecord", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-host-record-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("mints an id and a name on first run, and keeps them after", async () => {
    const first = await readOrMintHostRecord(dir, {
      hostname: () => "study-pc",
    });

    expect(first.id).toMatch(/^[a-z0-9-]{8,64}$/);
    // The shape is the host's one id pattern, not a second copy of it: a display
    // stores this id, so it has to be one a display could store.
    expect(DEVICE_ID_PATTERN.test(first.id)).toBe(true);
    expect(first.name).toBe("study-pc");
    // Written atomically, so the temporary file is gone once it returns.
    expect(await readdir(dir)).toEqual([FILE]);

    const again = await readOrMintHostRecord(dir, {
      hostname: () => "renamed-pc",
    });

    // The stored id and the stored name win; a host that changed its name in DNS
    // is not a second host, and re-minting would orphan every paired display.
    expect(again).toEqual(first);
  });

  it("refuses a stored record with no usable id, and mints a fresh one", async () => {
    await writeFile(
      path.join(dir, FILE),
      JSON.stringify({ id: "", name: "x" }),
      "utf8",
    );

    const record = await readOrMintHostRecord(dir, {
      hostname: () => "study-pc",
    });

    expect(record.id).not.toBe("");
    expect(DEVICE_ID_PATTERN.test(record.id)).toBe(true);
    // The unusable half is replaced on disk, so no later run serves an id no
    // display could have stored.
    expect(JSON.parse(await readFile(path.join(dir, FILE), "utf8"))).toEqual(
      record,
    );
  });

  it("keeps a usable stored name when the id is the unusable half", async () => {
    await writeFile(
      path.join(dir, FILE),
      JSON.stringify({ id: "Not An Id", name: "Study PC" }),
      "utf8",
    );

    const record = await readOrMintHostRecord(dir, {
      hostname: () => "study-pc",
    });

    expect(record.name).toBe("Study PC");
  });

  it("keeps a usable stored id and takes the name from the host", async () => {
    await writeFile(
      path.join(dir, FILE),
      JSON.stringify({ id: "a1b2c3d4e5f60718", name: "   " }),
      "utf8",
    );

    const record = await readOrMintHostRecord(dir, {
      hostname: () => "study-pc",
    });

    expect(record).toEqual({ id: "a1b2c3d4e5f60718", name: "study-pc" });
  });

  it("names a host whose hostname is blank with a prefix of its id", async () => {
    const first = await readOrMintHostRecord(dir, { hostname: () => "   " });

    // A blank name would leave a record every later run rewrites; the id is
    // already stored, so its prefix is the one stable name left.
    expect(first.name).toBe(first.id.slice(0, 8));
    expect(first.name.length).toBeGreaterThan(0);

    const again = await readOrMintHostRecord(dir, { hostname: () => "   " });
    expect(again).toEqual(first);
  });

  it("mints a fresh record when the stored file is malformed", async () => {
    await writeFile(path.join(dir, FILE), '{"id": "a1b2', "utf8");

    const record = await readOrMintHostRecord(dir, {
      hostname: () => "study-pc",
    });

    expect(record.name).toBe("study-pc");
    expect(DEVICE_ID_PATTERN.test(record.id)).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, FILE), "utf8"))).toEqual(
      record,
    );
  });

  it("bounds a long hostname at mint, so the served name does not change", async () => {
    const long = "h".repeat(120);

    const first = await readOrMintHostRecord(dir, { hostname: () => long });
    const again = await readOrMintHostRecord(dir, { hostname: () => long });

    expect(first.name.length).toBeLessThanOrEqual(64);
    // The name a display is served is the same on the next run: a cap only on
    // the stored half writes the hostname whole and truncates it on the read.
    expect(again).toEqual(first);
  });

  it("creates the settings folder when the host has never run", async () => {
    const fresh = path.join(dir, "settings");

    const record = await readOrMintHostRecord(fresh, {
      hostname: () => "study-pc",
    });

    expect(DEVICE_ID_PATTERN.test(record.id)).toBe(true);
    expect(await readdir(fresh)).toEqual([FILE]);
  });
});
