import { describe, expect, it } from "vitest";
import { powershellPath, startJsonLineHelper } from "../helpers/supervisor.js";
import { parseSmtcLine, SMTC_SCRIPT } from "./smtc-helper.js";

/**
 * The real path: PowerShell, WinRT and the machine's own session manager.
 * Gated so a non-Windows checkout skips rather than fails, and skipped when
 * this machine has no PowerShell 5.1 at the explicit path.
 */
const available =
  process.platform === "win32" && powershellPath() !== undefined;

/** One poll at most; PowerShell startup plus the WinRT call needs room. */
const FIRST_LINE_MS = 20_000;

interface FirstLine {
  /** The raw line, or the reason no line arrived. */
  readonly line?: string;
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
});
