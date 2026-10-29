import { randomInt } from "node:crypto";
import { sameToken } from "./pairing.js";

/**
 * The one-time code a display with no camera types, and the window it is valid
 * in.
 *
 * **One code is live at a time**, which is why a mismatch never burns it: there
 * is no second code for a wrong guess to name, so consuming on a mismatch would
 * hand anyone on the LAN a way to close the window a person is typing into.
 * Only a successful claim
 * consumes it, and the defence against guessing is the penalty below rather
 * than the window closing.
 */

/** No I, L, O, 0 or 1: the glyphs a person reads off one screen and types on another. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 6;

/** Minutes rather than hours: long enough to walk to the display and type six
 *  characters, short enough that a code left on a screen is not a standing key. */
export const DEFAULT_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export interface PairingCode {
  readonly code: string;
  readonly expiresAt: string;
}

export interface PairingCodeStore {
  mint(): PairingCode;
  /**
   * Consumes the live code on a match, and answers a source that keeps missing
   * with a growing delay.
   *
   * A delay and never a lockout: a lockout is a denial aimed at the person
   * pairing, who is not the one guessing. The answer is a bare yes or no for
   * the same reason — the route turns a `false` into one refusal whether the
   * code was wrong, spent or never there.
   */
  claim(code: string, source: string): Promise<boolean>;
  current(): PairingCode | undefined;
}

/** The delay before a source's second guess, doubling per miss up to the cap.
 *  The cap is what bounds how long a refused request holds its socket. */
const BASE_PENALTY_MS = 250;
const MAX_PENALTY_MS = 4000;

export function createPairingCodeStore(
  options: {
    readonly ttlMs?: number;
    readonly now?: () => number;
    readonly randomCode?: () => string;
    /** How the penalty is served. Injectable so a test does not wait it out. */
    readonly wait?: (ms: number) => Promise<void>;
  } = {},
): PairingCodeStore {
  const ttlMs = options.ttlMs ?? DEFAULT_PAIRING_CODE_TTL_MS;
  const now = options.now ?? Date.now;
  const randomCode = options.randomCode ?? drawCode;
  const wait =
    options.wait ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms)));

  let live: PairingCode | undefined;
  /** Misses by source. Cleared by a new code and by a success, because a window
   *  that has closed has nothing left to defend. */
  const misses = new Map<string, number>();

  /** The code as it stands, or nothing once its window has passed. */
  const current = (): PairingCode | undefined =>
    live !== undefined && Date.parse(live.expiresAt) > now() ? live : undefined;

  return {
    mint(): PairingCode {
      live = {
        code: randomCode(),
        expiresAt: new Date(now() + ttlMs).toISOString(),
      };
      misses.clear();
      return live;
    },

    current,

    async claim(code, source): Promise<boolean> {
      const missed = misses.get(source) ?? 0;

      // **Reserved before the await, not counted after it.** The count is read
      // again on the far side of the wait, so two claims in flight from one
      // source would both read the same number and both write it back — the
      // ladder would then advance once per batch of concurrent guesses, which
      // is N guesses at every rung for an attacker firing N at a time. Taking
      // the rung here is what makes the delay count guesses.
      misses.set(source, missed + 1);

      // The first miss is free: a person who mistyped once is the likeliest
      // caller of the second attempt, and making them wait for it would tax the
      // wrong one.
      if (missed > 0) {
        await wait(
          Math.min(BASE_PENALTY_MS * 2 ** (missed - 1), MAX_PENALTY_MS),
        );
      }

      // **Re-read after the wait, never before it.** The code can be spent by
      // the claim that was waiting beside this one, or expire while this one
      // waited, so a copy taken before the delay would let two correct callers
      // both succeed and would accept a window that has since closed.
      const shown = current();

      if (shown !== undefined && sameToken(code, shown.code)) {
        live = undefined;
        misses.delete(source);
        return true;
      }

      return false;
    },
  };
}

/** Six characters, each an independent draw: the modulo bias `randomInt` exists
 *  to avoid would make some codes likelier than others, and a code that is
 *  likelier is a shorter one. */
function drawCode(): string {
  let code = "";

  for (let drawn = 0; drawn < PAIRING_CODE_LENGTH; drawn += 1) {
    code += PAIRING_CODE_ALPHABET.charAt(
      randomInt(PAIRING_CODE_ALPHABET.length),
    );
  }

  return code;
}
