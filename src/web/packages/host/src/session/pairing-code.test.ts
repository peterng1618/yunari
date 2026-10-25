import { describe, expect, it } from "vitest";
import {
  createPairingCodeStore,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
} from "./pairing-code.js";

/** A store whose penalty costs no wall-clock time: the delay is asserted
 *  through the wait it asks for, and waiting it out would only be slower. */
function fast(
  waited: number[] = [],
): ReturnType<typeof createPairingCodeStore> {
  return createPairingCodeStore({
    wait: async (ms) => {
      waited.push(ms);
    },
  });
}

/** A wait a case resolves by hand, so two claims can be in flight together. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { wait, open };
}

describe("the one-time pairing code", () => {
  it("draws only from the alphabet a person can read back", () => {
    const store = fast();

    // 2000 draws, because a bias or a stray glyph is a property of the
    // generator and not of one call — the same reason a lock is fuzzed.
    for (let draw = 0; draw < 2000; draw += 1) {
      const { code } = store.mint();

      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      // The five glyphs a reader confuses with another one: I/1, L/1, O/0.
      expect(code).not.toMatch(/[ILO01]/);
      for (const glyph of code) expect(PAIRING_CODE_ALPHABET).toContain(glyph);
    }
  });

  it("consumes on a match and never on a mismatch", async () => {
    const store = fast();
    const { code } = store.mint();

    expect(await store.claim("ZZZZZZ", "192.168.1.5")).toBe(false);
    // The window is still open: one live code has nothing a wrong guess could
    // have named, so a guesser cannot close what a person is typing into.
    expect(store.current()?.code).toBe(code);
    expect(await store.claim(code, "192.168.1.5")).toBe(true);
    expect(store.current()).toBeUndefined();
  });

  it("expires", async () => {
    let clock = Date.parse("2026-10-18T10:00:00.000Z");
    const store = createPairingCodeStore({
      now: () => clock,
      ttlMs: 1000,
      wait: async () => {},
    });
    const { code, expiresAt } = store.mint();
    expect(expiresAt).toBe("2026-10-18T10:00:01.000Z");
    expect(store.current()?.code).toBe(code);

    clock += 1000;

    // Expired is not a second state a caller can see: it reads as no code, and
    // the right characters are refused exactly as wrong ones are.
    expect(store.current()).toBeUndefined();
    expect(await store.claim(code, "192.168.1.5")).toBe(false);
  });

  it("answers a source that keeps missing with a growing delay, never a lockout", async () => {
    const waited: number[] = [];
    const store = fast(waited);
    const { code } = store.mint();

    for (let guess = 0; guess < 5; guess += 1) {
      expect(await store.claim("ZZZZZZ", "10.0.0.9")).toBe(false);
    }

    // The first miss is free and each one after it doubles, capped so a refused
    // request holds its socket for a bounded time.
    expect(waited).toEqual([250, 500, 1000, 2000]);

    // And the right code still succeeds, which is the whole difference between
    // a penalty and a lockout.
    expect(await store.claim(code, "10.0.0.9")).toBe(true);
  });

  it("gives a code to exactly one of two concurrent correct claims", async () => {
    const waiting = gate();
    const store = createPairingCodeStore({ wait: () => waiting.wait });
    const { code } = store.mint();

    // One prior miss, so both correct claims below serve a penalty and are in
    // flight together. Without it the first claim runs to completion
    // synchronously and consumes the code before the second starts, which would
    // pass whether or not the code is re-read after the wait.
    await store.claim("ZZZZZZ", "192.168.1.5");

    const first = store.claim(code, "192.168.1.5");
    const second = store.claim(code, "192.168.1.5");
    waiting.open();

    // The second read the code after the wait and found it spent. A copy taken
    // before the wait would leave both true — one code, two displays.
    await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
  });

  it("refuses a correct code that expires while the penalty is being served", async () => {
    let clock = Date.parse("2026-10-18T10:00:00.000Z");
    const store = createPairingCodeStore({
      now: () => clock,
      ttlMs: 1000,
      // The window closes while the claim is held — the same clock a real
      // timeout reads, advanced from the other side of the await.
      wait: async () => {
        clock += 1000;
      },
    });
    const { code } = store.mint();

    // A free miss, so the claim below takes the penalty and waits.
    await store.claim("ZZZZZZ", "192.168.1.5");

    expect(await store.claim(code, "192.168.1.5")).toBe(false);
  });

  it("counts a rung per guess even when the guesses are in flight together", async () => {
    const waited: number[] = [];
    const store = fast(waited);
    const { code } = store.mint();

    // One source, five claims issued without awaiting any of them. The rung is
    // reserved before the wait, so each claim takes the next one; a count read
    // on the far side of the await would have all five read the same number and
    // settle on the free rung for ever — N guesses at every rung for an
    // attacker firing N at a time.
    const missed = await Promise.all(
      Array.from({ length: 5 }, () => store.claim("ZZZZZZ", "10.0.0.9")),
    );
    expect(missed).toEqual([false, false, false, false, false]);
    expect(waited).toEqual([250, 500, 1000, 2000]);

    // And the ladder kept what those five spent: the sixth claim — the right
    // code — is the sixth guess, not the second.
    expect(await store.claim(code, "10.0.0.9")).toBe(true);
    expect(waited).toEqual([250, 500, 1000, 2000, 4000]);
  });

  it("counts misses per source, so one guesser never delays another", async () => {
    const waited: number[] = [];
    const store = fast(waited);
    const { code } = store.mint();

    await store.claim("ZZZZZZ", "10.0.0.9");
    await store.claim("ZZZZZZ", "10.0.0.9");
    expect(waited).toEqual([250]);

    expect(await store.claim(code, "10.0.0.8")).toBe(true);
    expect(waited).toEqual([250]);
  });

  it("forgets the penalty when a new code replaces the window", async () => {
    const waited: number[] = [];
    const store = fast(waited);
    store.mint();
    await store.claim("ZZZZZZ", "10.0.0.9");

    store.mint();

    // A closed window's misses defend nothing, and carrying them over would
    // charge a source for a code it can no longer guess.
    await store.claim("ZZZZZZ", "10.0.0.9");
    expect(waited).toEqual([]);
  });
});
