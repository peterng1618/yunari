import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { powershellPath, startJsonLineHelper } from "../helpers/supervisor.js";
import {
  parseSmtcLine,
  SMTC_ARTWORK_FUNCTIONS,
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
/**
 * Long enough for a session line, the track's artwork read and a re-poll. A
 * session present with no artwork line across this window is a failure, not a
 * pass: the artwork path has to be observed, not assumed.
 */
const ARTWORK_WINDOW_MS = 20_000;

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

/**
 * Runs the artwork script until a line proves an outcome (an artwork line, or
 * `none` for a session-less machine) or the window expires.
 */
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
      onLine: (line) => {
        lines.push(line);
        const kind = (JSON.parse(line) as { kind?: unknown }).kind;
        if (kind === "artwork" || kind === "none") finish();
      },
      onExit: (reason, kind) => {
        if (kind !== "stopped") finish(reason);
      },
    });
  });
}

interface RunResult {
  readonly stdout: string;
  readonly failure?: string;
}

/** Runs a one-shot script on the explicit PowerShell path and returns stdout. */
function runPowerShell(script: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const executable = powershellPath();
    if (executable === undefined) {
      resolve({ stdout: "", failure: "PowerShell was not found" });
      return;
    }

    const child = spawn(
      executable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", (error: Error) => {
      resolve({ stdout, failure: error.message });
    });
    child.once("exit", (code: number | null) => {
      resolve(
        code === 0
          ? { stdout }
          : { stdout, failure: `exit ${String(code)}: ${stderr.slice(-300)}` },
      );
    });
  });
}

type WindowVerdict = "no-session" | "error" | "session";

/**
 * The window's outcome, decided from its first line. A `none` from a later
 * poll means the session disappeared; it is not a session-less machine, and
 * must not turn the artwork assertion into a vacuous pass.
 */
function windowVerdict(lines: readonly string[]): WindowVerdict {
  const kinds = lines.map(
    (line) => (JSON.parse(line) as { kind?: unknown }).kind,
  );
  if (kinds[0] === "none") return "no-session";
  if (kinds.includes("error")) return "error";
  return "session";
}

describe("artwork window classification", () => {
  const line = (kind: string): string => JSON.stringify({ kind });

  it("treats a session that disappears mid-window as a session window", () => {
    expect(windowVerdict([line("session"), line("none")])).toBe("session");
  });

  it("treats a first-line none as a session-less machine", () => {
    expect(windowVerdict([line("none"), line("none")])).toBe("no-session");
  });

  it("does not hide an error line behind a later none", () => {
    expect(windowVerdict([line("session"), line("error")])).toBe("error");
  });
});

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

  it("runs the artwork half and observes at least one artwork line", async (context) => {
    const { lines, failure } = await collectArtworkLines();

    expect(failure, "the helper must answer within its window").toBeUndefined();
    expect(lines.length).toBeGreaterThan(0);

    const kinds = lines.map(
      (line) => (JSON.parse(line) as { kind?: unknown }).kind,
    );
    const verdict = windowVerdict(lines);

    if (verdict === "no-session") {
      // Decided from the first line: no session exists. Report that plainly
      // and mark the run vacuous instead of claiming an artwork proof.
      context.skip("no media session on this machine; artwork unverified");
      return;
    }

    // A session was present, so the artwork branch must have executed. Without
    // a line the test would otherwise pass while proving nothing.
    expect(verdict).not.toBe("error");
    for (const kind of kinds) {
      expect(["session", "artwork", "none"]).toContain(kind);
    }

    const artworkLines = lines.filter(
      (line) => (JSON.parse(line) as { kind?: unknown }).kind === "artwork",
    );

    expect(
      artworkLines.length,
      "a media session was present but no artwork line appeared in the window; " +
        "silence from the artwork half is a failure, not a pass",
    ).toBeGreaterThan(0);

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
  }, 40_000);

  it("reads a definitive miss once and retries only a thrown load", async () => {
    // The real artwork functions, with the WinRT read stood in for: a null is
    // the over-cap/no-thumbnail/trailer answer, a throw is a load error.
    const harness = [
      SMTC_ARTWORK_FUNCTIONS,
      "$WantArtwork = $true",
      "$lastArtwork = @{}",
      "$script:reads = 0",
      "function Get-ArtworkLine($session) { $script:reads += 1; return $null }",
      "Try-EmitArtwork $null @{ sessionId = 'x'; title = 't'; artist = 'a'; album = 'b' }",
      "Try-EmitArtwork $null @{ sessionId = 'x'; title = 't'; artist = 'a'; album = 'b' }",
      '[Console]::Out.WriteLine("definite=$script:reads")',
      "$script:reads = 0",
      "$script:fail = $true",
      "function Get-ArtworkLine($session) { $script:reads += 1; if ($script:fail) { $script:fail = $false; throw 'load failed' }; return $null }",
      "Try-EmitArtwork $null @{ sessionId = 'y'; title = 't'; artist = 'a'; album = 'b' }",
      "Try-EmitArtwork $null @{ sessionId = 'y'; title = 't'; artist = 'a'; album = 'b' }",
      '[Console]::Out.WriteLine("thrown=$script:reads")',
    ].join("\n");

    const { stdout, failure } = await runPowerShell(harness);

    expect(failure).toBeUndefined();
    // A definitive miss is recorded: two polls, one read.
    expect(stdout).toContain("definite=1");
    // A thrown read is not recorded: it is attempted again on the next poll.
    expect(stdout).toContain("thrown=2");
  }, 30_000);
});
