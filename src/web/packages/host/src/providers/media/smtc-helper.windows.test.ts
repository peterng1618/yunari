import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { powershellPath, startJsonLineHelper } from "../helpers/supervisor.js";
import {
  parseSmtcLine,
  SMTC_SCRIPT,
  smtcArtworkLine,
  smtcScript,
} from "./smtc-helper.js";

/**
 * The real path: PowerShell, WinRT and the machine's own session manager.
 * Gated so a non-Windows checkout skips rather than fails, and skipped when
 * this machine has no PowerShell 5.1 at the explicit path.
 */
const available =
  process.platform === "win32" && powershellPath() !== undefined;

/** One poll at most; PowerShell startup plus the WinRT call needs room. */
const FIRST_LINE_MS = 20_000;
/** Long enough for a session line, a track-change artwork read, and a re-poll. */
const ARTWORK_WINDOW_MS = 5_000;

interface FirstLine {
  /** The raw line, or the reason no line arrived. */
  readonly line?: string;
  readonly failure?: string;
}

interface Collection {
  readonly lines: string[];
  readonly failure?: string;
}

function firstLine(): Promise<FirstLine> {
  return new Promise((resolve) => {
    let settled = false;
    let handle: { stop(): void } | undefined;

    const finish = (result: FirstLine): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handle?.stop();
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ failure: `no line within ${FIRST_LINE_MS} ms` }),
      FIRST_LINE_MS,
    );

    handle = startJsonLineHelper({
      id: "smtc",
      script: SMTC_SCRIPT,
      timeoutMs: FIRST_LINE_MS + 5_000,
      onLine: (line) => finish({ line }),
      onExit: (reason, kind) => {
        if (kind !== "stopped") finish({ failure: reason });
      },
    });
  });
}

/** Runs the artwork script for a fixed window and returns every line. */
function collectArtworkLines(): Promise<Collection> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let settled = false;
    let handle: { stop(): void } | undefined;

    const finish = (failure?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handle?.stop();
      resolve(failure === undefined ? { lines } : { lines, failure });
    };

    const timer = setTimeout(() => finish(), ARTWORK_WINDOW_MS);

    handle = startJsonLineHelper({
      id: "smtc-artwork",
      script: smtcScript({ artwork: true }),
      timeoutMs: ARTWORK_WINDOW_MS + 5_000,
      onLine: (line) => lines.push(line),
      onExit: (reason, kind) => {
        if (kind !== "stopped") finish(reason);
      },
    });
  });
}

describe.skipIf(!available)("SMTC helper on Windows", () => {
  it("emits a parseable JSON line, with a title when a session exists", async () => {
    const { line, failure } = await firstLine();

    expect(failure, "the helper must answer within its window").toBeUndefined();
    expect(line).toBeDefined();

    const record = JSON.parse(line ?? "") as { kind?: unknown };

    if (record.kind === "none") {
      // Reported plainly: the machine has no media session right now. That
      // is not a pass of the title assertion, and the test says so.
      expect(record).toEqual({ kind: "none" });
      return;
    }

    const session = parseSmtcLine(line ?? "");
    expect(session).toBeDefined();
    expect(session?.title.length).toBeGreaterThan(0);
    expect(["playing", "paused", "stopped"]).toContain(session?.state);
    expect(session?.sessionId.length).toBeGreaterThan(0);
  }, 30_000);

  it("runs the artwork half and never reports an error line", async () => {
    const { lines, failure } = await collectArtworkLines();

    expect(failure, "the helper must answer within its window").toBeUndefined();
    expect(lines.length).toBeGreaterThan(0);

    const kinds = lines.map((line) => {
      const record = JSON.parse(line) as { kind?: unknown };
      return record.kind;
    });

    // Get-ArtworkLine actually executes in this mode: before it existed, the
    // artwork branch was dead code the metadata test could not reach.
    for (const kind of kinds) {
      expect(["session", "artwork", "none"]).toContain(kind);
    }
    expect(kinds).not.toContain("error");

    if (kinds.includes("none")) {
      // No session exists on this machine right now. Say that plainly rather
      // than passing the session and artwork assertions vacuously.
      expect(kinds.every((kind) => kind === "none")).toBe(true);
      return;
    }

    for (const line of lines) {
      const record = JSON.parse(line) as { kind?: unknown };

      if (record.kind === "session") {
        expect(parseSmtcLine(line)).toBeDefined();
      }

      if (record.kind === "artwork") {
        const artwork = smtcArtworkLine(line);
        expect(artwork).toBeDefined();
        if (artwork === undefined) continue;

        expect(["png", "jpg", "jpeg", "webp"]).toContain(artwork.ext);
        expect(artwork.bytes.length).toBeGreaterThan(0);
        expect(createHash("sha256").update(artwork.bytes).digest("hex")).toBe(
          artwork.sha256,
        );
      }
    }
  }, 30_000);
});
