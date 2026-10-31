import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireHostLock, pidIsAlive } from "./host-lock.js";

const FILE = "host.lock";

/** A pid probe that answers what the test needs, so no case needs a real
 *  process to be alive or dead at the moment it runs. */
const live = { isPidAlive: () => true };
const gone = { isPidAlive: () => false };

function failure(code: string): () => never {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

describe("pidIsAlive", () => {
  it("reads this process as alive", () => {
    expect(pidIsAlive(process.pid)).toBe(true);
  });

  it("reads ESRCH as gone", () => {
    expect(pidIsAlive(4, failure("ESRCH"))).toBe(false);
  });

  it("reads EPERM as alive, because it names a process this one may not signal", () => {
    // The distinction the whole lock rests on: on Windows — and for any process
    // owned by another user — signalling a *live* pid raises EPERM. Reading that
    // as gone would let a second host steal a live host's folder.
    expect(pidIsAlive(4, failure("EPERM"))).toBe(true);
  });

  it("reads an unknown failure as alive, because it is not proof of absence", () => {
    expect(pidIsAlive(4, failure("EINVAL"))).toBe(true);
  });
});

describe("acquireHostLock", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-host-lock-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a folder a live host already holds", async () => {
    const settingsDir = path.join(dir, "settings");
    const first = await acquireHostLock(settingsDir, 5227, live);
    expect(first.ok).toBe(true);
    // Written atomically, so the temporary file is gone once it returns.
    expect(await readdir(settingsDir)).toEqual([FILE]);

    const second = await acquireHostLock(settingsDir, 5228, live);

    if (second.ok) {
      throw new Error("a folder a live host holds was taken anyway");
    }

    // The refusal names the folder that is held, the port the other host is on,
    // and the flag that separates two installs — and the folder it offers that
    // flag is the app folder, one level up from the held one.
    expect(second.reason).toContain(settingsDir);
    expect(second.reason).toContain("5227");
    expect(second.reason).toContain("--app-dir");
    expect(second.reason).toContain(`other than ${dir}`);
  });

  it("takes the folder back after the holder releases", async () => {
    const held = await acquireHostLock(dir, 5227, live);
    if (!held.ok) {
      throw new Error(held.reason);
    }

    await held.lock.release();
    expect(await readdir(dir)).toEqual([]);

    const again = await acquireHostLock(dir, 5227, live);
    expect(again.ok).toBe(true);
  });

  it("releases twice without throwing, including after the file is gone", async () => {
    const held = await acquireHostLock(dir, 5227, live);
    if (!held.ok) {
      throw new Error(held.reason);
    }

    await held.lock.release();
    await held.lock.release();

    expect(await readdir(dir)).toEqual([]);
  });

  it("leaves a lock another host has taken, so a third cannot start", async () => {
    const held = await acquireHostLock(dir, 5227, live);
    if (!held.ok) {
      throw new Error(held.reason);
    }

    // Something removed this lock while this process ran — a hand deletion, or
    // a tool that takes the folder over — so a second host took it. This
    // process's exit must not hand the folder to a third.
    const other = { pid: 4, port: 5228 };
    await writeFile(path.join(dir, FILE), JSON.stringify(other), "utf8");

    await held.lock.release();

    expect(JSON.parse(await readFile(path.join(dir, FILE), "utf8"))).toEqual(
      other,
    );
  });

  it("takes a folder whose holder is gone", async () => {
    await writeFile(
      path.join(dir, FILE),
      JSON.stringify({ pid: 4, port: 5227 }),
      "utf8",
    );

    const taken = await acquireHostLock(dir, 5228, gone);

    if (!taken.ok) {
      throw new Error(`a stale lock was respected: ${taken.reason}`);
    }

    // The dead host's record is replaced, not left beside this one's.
    expect(
      JSON.parse(await readFile(path.join(dir, FILE), "utf8")),
    ).toMatchObject({ pid: process.pid, port: 5228 });
  });

  it("takes a lock file a crash left empty or truncated", async () => {
    for (const contents of ["", "\n", "{", '{"pid":', '{"pid": 4, "port":']) {
      await writeFile(path.join(dir, FILE), contents, "utf8");

      const taken = await acquireHostLock(dir, 5227, live);

      if (!taken.ok) {
        throw new Error(
          `"${contents}" was read as a live holder: ${taken.reason}`,
        );
      }

      await taken.lock.release();
    }
  });

  it("refuses a lock naming a pid the probe cannot rule out", async () => {
    // A readable pid the probe reads as alive is respected whatever port it
    // names: the folder is taken only when the probe says the holder is gone.
    await writeFile(
      path.join(dir, FILE),
      JSON.stringify({ pid: process.pid, port: 5227 }),
      "utf8",
    );

    const second = await acquireHostLock(dir, 5228, live);
    expect(second.ok).toBe(false);
  });

  it("takes a lock with no readable pid, because a live host always writes one", async () => {
    // R21's direction, and the reason it is the safe one: a file that names no
    // holder is what a process that died mid-write leaves, and respecting it
    // would lock the owner out of their own library — while a *live* host always
    // writes its pid, so nothing live is ever missed.
    await writeFile(
      path.join(dir, FILE),
      JSON.stringify({ port: 5227 }),
      "utf8",
    );

    const taken = await acquireHostLock(dir, 5228, live);

    if (!taken.ok) {
      throw new Error(`a lock naming no pid was respected: ${taken.reason}`);
    }
  });

  it("creates the settings folder when the host has never run", async () => {
    const fresh = path.join(dir, "settings");

    const held = await acquireHostLock(fresh, 5227, live);

    expect(held.ok).toBe(true);
    expect(await readdir(fresh)).toEqual([FILE]);
  });
});
