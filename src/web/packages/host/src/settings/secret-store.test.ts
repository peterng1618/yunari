import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOsKeyProtector, type KeyProtector } from "./os-key-protector.js";
import { createSecretStore } from "./secret-store.js";

const keyFile = (dir: string) => path.join(dir, "secret.key");
const secretFile = (dir: string, name: string) => path.join(dir, `${name}.bin`);

/**
 * The store's format is what these tests prove, so the protector is a
 * reversible transform rather than DPAPI. The real protector gets its own case.
 */
function createFakeProtector(usable = true): KeyProtector & {
  wraps: number;
} {
  const protector = {
    wraps: 0,
    async available() {
      return usable;
    },
    async wrap(key: Uint8Array) {
      protector.wraps += 1;
      return Uint8Array.from(key, (byte) => byte ^ 0x5a);
    },
    async unwrap(wrapped: Uint8Array) {
      return Uint8Array.from(wrapped, (byte) => byte ^ 0x5a);
    },
  };
  return protector;
}

/** Bytes that differ per length, so a truncation or offset bug is visible. */
function bytesOf(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 7 + length) & 0xff);
}

describe("secret store", () => {
  let dir: string;
  let protector: ReturnType<typeof createFakeProtector>;
  let store: ReturnType<typeof createSecretStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-secret-store-"));
    protector = createFakeProtector();
    store = createSecretStore(dir, protector);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips every byte length from 0 through 255", async () => {
    for (let length = 0; length <= 255; length += 1) {
      const plaintext = bytesOf(length);

      await store.write("blob", plaintext);

      const read = await store.read("blob");
      expect(read?.length).toBe(length);
      expect(read ? read.equals(Buffer.from(plaintext)) : false).toBe(true);
    }
  }, 60_000);

  it("keeps an empty secret distinct from an absent one", async () => {
    await store.write("empty", new Uint8Array(0));

    const read = await store.read("empty");
    expect(read).toBeDefined();
    expect(read?.length).toBe(0);
    expect(await store.read("absent")).toBeUndefined();
  });

  it("throws on a tampered ciphertext byte", async () => {
    await store.write("tampered", bytesOf(24));

    const file = secretFile(dir, "tampered");
    const raw = await readFile(file);
    raw[12 + 16] = (raw[12 + 16] as number) ^ 0xff;
    await writeFile(file, raw);

    await expect(store.read("tampered")).rejects.toThrow();
  });

  it("throws on a tampered tag byte", async () => {
    await store.write("tampered", bytesOf(24));

    const file = secretFile(dir, "tampered");
    const raw = await readFile(file);
    raw[12] = (raw[12] as number) ^ 0xff;
    await writeFile(file, raw);

    await expect(store.read("tampered")).rejects.toThrow();
  });

  it("throws on a truncated secret file", async () => {
    await store.write("short", bytesOf(16));

    const file = secretFile(dir, "short");
    await writeFile(file, (await readFile(file)).subarray(0, 10));

    // Pins the length guard: without it the short buffer fails inside the
    // cipher and the error would not name the truncation.
    await expect(store.read("short")).rejects.toThrow(/incomplete/);
  });

  it("answers undefined when neither the secret nor its key exists", async () => {
    await rm(keyFile(dir), { force: true });

    expect(await store.read("alpha")).toBeUndefined();
  });

  it("throws when a stored secret's key file is gone", async () => {
    await store.write("alpha", bytesOf(6));
    await rm(keyFile(dir), { force: true });

    await expect(store.read("alpha")).rejects.toThrow();
  });

  it("refuses to write with a cached key once the key file is gone", async () => {
    await store.write("alpha", bytesOf(6));
    await rm(keyFile(dir), { force: true });

    await expect(store.write("beta", bytesOf(4))).rejects.toThrow(/key file/);
    await expect(readFile(secretFile(dir, "beta"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("creates nothing when asked only whether it is available", async () => {
    expect(await store.available()).toBe(true);
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers false when the protector rejects, then true", async () => {
    let calls = 0;
    const flaky: KeyProtector = {
      async available() {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return true;
      },
      async wrap(key) {
        return Uint8Array.from(key);
      },
      async unwrap(wrapped) {
        return Uint8Array.from(wrapped);
      },
    };
    const flakyStore = createSecretStore(dir, flaky);

    expect(await flakyStore.available()).toBe(false);
    expect(await flakyStore.available()).toBe(true);
  });

  it("recreates an empty key file, which wraps no key", async () => {
    await writeFile(keyFile(dir), "", "utf8");

    await store.write("alpha", bytesOf(3));

    expect((await readFile(keyFile(dir))).length).toBeGreaterThan(0);
    const read = await store.read("alpha");
    expect(read?.equals(Buffer.from(bytesOf(3)))).toBe(true);
  });

  it("throws on a non-empty key file that does not parse", async () => {
    await writeFile(keyFile(dir), "not a key", "utf8");

    await expect(store.write("alpha", bytesOf(3))).rejects.toThrow();
  });

  it("creates one key when two stores first write together", async () => {
    const first = createSecretStore(dir, createFakeProtector());
    const second = createSecretStore(dir, createFakeProtector());

    await Promise.all([
      first.write("one", bytesOf(9)),
      second.write("two", bytesOf(13)),
    ]);

    expect((await readdir(dir)).sort()).toEqual([
      "one.bin",
      "secret.key",
      "two.bin",
    ]);

    const fromFirst = await first.read("one");
    const fromSecond = await second.read("two");
    expect(fromFirst?.equals(Buffer.from(bytesOf(9)))).toBe(true);
    expect(fromSecond?.equals(Buffer.from(bytesOf(13)))).toBe(true);
  });

  it("shares one wrapped key between stores in the same directory", async () => {
    await store.write("alpha", bytesOf(17));
    const keyBefore = await readFile(keyFile(dir));

    const other = createSecretStore(dir, createFakeProtector());
    expect(await other.available()).toBe(true);

    const readByOther = await other.read("alpha");
    expect(readByOther?.equals(Buffer.from(bytesOf(17)))).toBe(true);

    await other.write("beta", bytesOf(31));

    const readByFirst = await store.read("beta");
    expect(readByFirst?.equals(Buffer.from(bytesOf(31)))).toBe(true);

    const keyAfter = await readFile(keyFile(dir));
    expect(keyAfter.equals(keyBefore)).toBe(true);
  });

  it("refuses to write when the protector is unavailable, creating nothing", async () => {
    const unavailable = createFakeProtector(false);
    const refusingStore = createSecretStore(dir, unavailable);

    expect(await refusingStore.available()).toBe(false);
    await expect(refusingStore.write("alpha", bytesOf(8))).rejects.toThrow();
    expect(unavailable.wraps).toBe(0);

    await expect(readFile(keyFile(dir))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(secretFile(dir, "alpha"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses an invalid name on write and answers undefined on read", async () => {
    const invalid = ["../x", "a/b", "", "a".repeat(65)];

    for (const name of invalid) {
      await expect(store.write(name, bytesOf(4))).rejects.toThrow();
      expect(await store.read(name)).toBeUndefined();
      await expect(store.remove(name)).rejects.toThrow();
    }

    expect(await readdir(dir)).toEqual([]);
  });

  it("removes a stored secret and treats a missing one as a no-op", async () => {
    await store.write("alpha", bytesOf(5));

    await store.remove("alpha");

    expect(await store.read("alpha")).toBeUndefined();
    await expect(store.remove("alpha")).resolves.toBeUndefined();
  });

  describe("the real OS key protector", () => {
    const protectorForThisMachine = createOsKeyProtector();
    let available = false;

    beforeAll(async () => {
      available = await protectorForThisMachine.available();
    });

    it("wraps and unwraps a random 32-byte key through the OS facility", async (ctx) => {
      // `secret-tool` does not exist on this Windows host; the Linux branch is
      // unexercised here rather than falsely reported as proven.
      if (!available) {
        ctx.skip();
        return;
      }

      const key = randomBytes(32);
      const wrapped = await protectorForThisMachine.wrap(key);

      // Only the round trip is asserted: on Linux the wrapped blob is the
      // empty marker and the key itself lives in the keyring.
      const unwrapped = await protectorForThisMachine.unwrap(wrapped);
      expect(Buffer.from(unwrapped).equals(key)).toBe(true);
    }, 60_000);
  });
});
