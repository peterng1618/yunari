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
      // The helper also emits the endpoint audio line every poll; this case is
      // about the session line, so audio is not its first answer.
      onLine: (line) => {
        if ((JSON.parse(line) as { kind?: unknown }).kind !== "audio") {
          finish({ line });
        }
      },
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
        const kind = (JSON.parse(line) as { kind?: unknown }).kind;
        // Audio is a separate reading; this window classifies the media half.
        if (kind === "audio") return;
        lines.push(line);
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

interface WindowRecord {
  readonly kind?: unknown;
  readonly hasArtwork?: unknown;
  readonly app?: unknown;
  readonly title?: unknown;
}

type WindowVerdict = "no-session" | "error" | "session";
type ArtworkExpectation =
  | "no-session"
  | "session-closed"
  | "no-thumbnail"
  | "artwork-expected";

function recordsOf(lines: readonly string[]): WindowRecord[] {
  return lines.map((line) => JSON.parse(line) as WindowRecord);
}

/**
 * The window's outcome, decided from its first line. A `none` from a later
 * poll means the session disappeared; it is not a session-less machine, and
 * must not turn the artwork assertion into a vacuous pass.
 */
function windowVerdict(records: readonly WindowRecord[]): WindowVerdict {
  const kinds = records.map((record) => record.kind);
  if (kinds[0] === "none") return "no-session";
  if (kinds.includes("error")) return "error";
  return "session";
}

/**
 * Artwork is required only when a session stayed present and reported a
 * thumbnail. A session that closed mid-window, or one with no thumbnail,
 * leaves the artwork path unverified rather than failing.
 */
function artworkExpectation(
  records: readonly WindowRecord[],
): ArtworkExpectation {
  const kinds = records.map((record) => record.kind);
  if (kinds[0] === "none") return "no-session";

  const sessionAcrossWindow =
    kinds.every((kind) => kind === "session" || kind === "artwork") ||
    kinds.at(-1) === "session";
  if (!sessionAcrossWindow) return "session-closed";

  const thumbnailSeen = records.some(
    (record) => record.kind === "session" && record.hasArtwork === true,
  );
  if (!thumbnailSeen) return "no-thumbnail";

  return "artwork-expected";
}

describe("artwork window classification", () => {
  const record = (fields: WindowRecord): string => JSON.stringify(fields);

  it("treats a session that disappears mid-window as unverifiable", () => {
    const records = recordsOf([
      record({ kind: "session", hasArtwork: true }),
      record({ kind: "none" }),
    ]);
    expect(windowVerdict(records)).toBe("session");
    expect(artworkExpectation(records)).toBe("session-closed");
  });

  it("treats a first-line none as a session-less machine", () => {
    const records = recordsOf([
      record({ kind: "none" }),
      record({ kind: "none" }),
    ]);
    expect(artworkExpectation(records)).toBe("no-session");
  });

  it("does not hide an error line behind a later none", () => {
    expect(
      windowVerdict(
        recordsOf([record({ kind: "session" }), record({ kind: "error" })]),
      ),
    ).toBe("error");
  });

  it("does not require artwork from a session with no thumbnail", () => {
    expect(
      artworkExpectation(
        recordsOf([
          record({ kind: "session", hasArtwork: false }),
          record({ kind: "session", hasArtwork: false }),
        ]),
      ),
    ).toBe("no-thumbnail");
  });

  it("requires artwork from a session that reported a thumbnail", () => {
    expect(
      artworkExpectation(
        recordsOf([
          record({ kind: "session", hasArtwork: true }),
          record({ kind: "session", hasArtwork: true }),
        ]),
      ),
    ).toBe("artwork-expected");
  });

  it("classifies a successful window that ends on an artwork line", () => {
    // The shape a healthy helper actually produces: a session line followed by
    // the track's artwork line. It is still a session window.
    const records = recordsOf([
      record({ kind: "session", hasArtwork: true }),
      record({ kind: "artwork" }),
    ]);
    expect(windowVerdict(records)).toBe("session");
    expect(artworkExpectation(records)).toBe("artwork-expected");
  });

  it("treats a window that ends on a session line as not closed", () => {
    // A `none` in the middle is a lost poll, not a lost session.
    const records = recordsOf([
      record({ kind: "session", hasArtwork: true }),
      record({ kind: "none" }),
      record({ kind: "session", hasArtwork: true }),
    ]);
    expect(windowVerdict(records)).toBe("session");
    expect(artworkExpectation(records)).toBe("artwork-expected");
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

    const records = recordsOf(lines);
    const verdict = windowVerdict(records);

    if (verdict === "no-session") {
      context.skip("no media session on this machine; artwork unverified");
      return;
    }

    expect(verdict, "the helper reported an error line").not.toBe("error");
    for (const record of records) {
      expect(["session", "artwork", "none"]).toContain(record.kind);
    }

    const expectation = artworkExpectation(records);
    if (expectation !== "artwork-expected") {
      // Not fine, but not this test's defect: the machine cannot show whether
      // a track that has artwork produces its line.
      context.skip(
        expectation === "session-closed"
          ? "the session closed before the window ended; artwork unverified"
          : "the session reported no thumbnail; artwork unverified",
      );
      return;
    }

    const artworkLines = lines.filter(
      (line) => (JSON.parse(line) as WindowRecord).kind === "artwork",
    );
    const firstSession = records.find((record) => record.kind === "session");
    const app =
      typeof firstSession?.app === "string" ? firstSession.app : "unknown app";
    const title =
      typeof firstSession?.title === "string"
        ? firstSession.title
        : "unknown title";

    expect(
      artworkLines.length,
      `${app} / ${title} reported a thumbnail but emitted no artwork line in ` +
        `${ARTWORK_WINDOW_MS} ms. A red here is a defect only for a thumbnail ` +
        "the helper could read whole and under the size cap: no thumbnail, an " +
        "over-cap thumbnail, and one still truncated after the retry limit are " +
        "all legitimate negatives that emit nothing by specification",
    ).toBeGreaterThan(0);

    for (const line of lines) {
      const record = JSON.parse(line) as WindowRecord;

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

  it("emits a stub line, reads over-cap once, and retries misses and throws", async () => {
    // The real artwork functions with the WinRT read stood in for. The first
    // block proves the emission itself reaches stdout, so deleting it reds
    // this test without needing a live thumbnail.
    const harness = [
      SMTC_ARTWORK_FUNCTIONS,
      "$WantArtwork = $true",
      "$lastArtwork = @{}",
      "$script:reads = 0",
      "function Get-ArtworkResult($session) { $script:reads += 1; return @{ status = 'artwork'; line = [ordered]@{ kind = 'artwork'; sessionId = 'x'; sha256 = 'a' * 64; ext = 'png'; base64 = 'AQ==' } } }",
      "Try-EmitArtwork $null @{ sessionId = 'x'; title = 't'; artist = 'a'; album = 'b' }",
      '[Console]::Out.WriteLine("emitted=$script:reads")',
      "$script:reads = 0",
      "function Get-ArtworkResult($session) { $script:reads += 1; return @{ status = 'over' } }",
      "Try-EmitArtwork $null @{ sessionId = 'y'; title = 't'; artist = 'a'; album = 'b' }",
      "Try-EmitArtwork $null @{ sessionId = 'y'; title = 't'; artist = 'a'; album = 'b' }",
      '[Console]::Out.WriteLine("over=$script:reads")',
      "$script:reads = 0",
      "$script:beat = 0",
      "function Get-ArtworkResult($session) { $script:reads += 1; $script:beat += 1; if ($script:beat -lt 3) { return @{ status = 'retry' } }; return @{ status = 'artwork'; line = [ordered]@{ kind = 'artwork'; sessionId = 'z'; sha256 = 'b' * 64; ext = 'png'; base64 = 'AQ==' } } }",
      "Try-EmitArtwork $null @{ sessionId = 'z'; title = 't'; artist = 'a'; album = 'b' }",
      "Try-EmitArtwork $null @{ sessionId = 'z'; title = 't'; artist = 'a'; album = 'b' }",
      "Try-EmitArtwork $null @{ sessionId = 'z'; title = 't'; artist = 'a'; album = 'b' }",
      '[Console]::Out.WriteLine("retried=$script:reads")',
      "$script:reads = 0",
      "$script:fail = $true",
      "function Get-ArtworkResult($session) { $script:reads += 1; if ($script:fail) { $script:fail = $false; throw 'load failed' }; return @{ status = 'over' } }",
      "Try-EmitArtwork $null @{ sessionId = 'w'; title = 't'; artist = 'a'; album = 'b' }",
      "Try-EmitArtwork $null @{ sessionId = 'w'; title = 't'; artist = 'a'; album = 'b' }",
      '[Console]::Out.WriteLine("thrown=$script:reads")',
      // An exhausted track is cached: after the retry limit, later polls of
      // the same track do not read again.
      "$script:reads = 0",
      "function Get-ArtworkResult($session) { $script:reads += 1; return @{ status = 'retry' } }",
      "for ($i = 0; $i -lt 8; $i++) { Try-EmitArtwork $null @{ sessionId = 'v'; title = 't'; artist = 'a'; album = 'b' } }",
      '[Console]::Out.WriteLine("exhausted=$script:reads")',
      // The real Get-SessionLine reports whether a thumbnail exists, with the
      // WinRT wait stood in for: no live session needed.
      "$global:smtcProps = [pscustomobject]@{ Title = 't'; Artist = 'a'; AlbumTitle = 'b'; Thumbnail = [pscustomobject]@{} }",
      "function Wait-WinRt($operation, $resultType) { return $global:smtcProps }",
      "$smtcSession = [pscustomobject]@{ SourceAppUserModelId = 'app.exe' }",
      "$smtcSession | Add-Member -MemberType ScriptMethod -Name GetPlaybackInfo -Value { return [pscustomobject]@{ PlaybackStatus = 'Playing' } }",
      "$smtcSession | Add-Member -MemberType ScriptMethod -Name GetTimelineProperties -Value { return [pscustomobject]@{ Position = [TimeSpan]::FromSeconds(1); LastUpdatedTime = [DateTimeOffset]::UtcNow; EndTime = [TimeSpan]::FromSeconds(10) } }",
      "$smtcSession | Add-Member -MemberType ScriptMethod -Name TryGetMediaPropertiesAsync -Value { return $null }",
      "$smtcWithArtwork = Get-SessionLine $smtcSession",
      "$global:smtcProps.Thumbnail = $null",
      "$smtcWithoutArtwork = Get-SessionLine $smtcSession",
      '[Console]::Out.WriteLine("hasArtwork=$($smtcWithArtwork.hasArtwork),$($smtcWithoutArtwork.hasArtwork)")',
      // No registry entry exists for this AUMID, so the name falls back to
      // the AUMID itself rather than an empty or guessed label.
      '[Console]::Out.WriteLine("appFallback=" + (Get-AppName "yunari-no-such-aumid.exe"))',
    ].join("\n");

    const { stdout, failure } = await runPowerShell(harness);

    expect(failure).toBeUndefined();
    // A complete result reaches stdout as its own JSON line.
    expect(stdout).toContain('"kind":"artwork"');
    expect(stdout).toContain('"base64":"AQ=="');
    expect(stdout).toContain("emitted=1");
    // Over-cap is definitive: two polls, one read.
    expect(stdout).toContain("over=1");
    // A retryable miss on polls 1 and 2 still emits on poll 3.
    expect(stdout).toContain("retried=3");
    // A thrown load is not recorded: it is attempted again on the next poll.
    expect(stdout).toContain("thrown=2");
    // Five retryable polls exhaust the limit; the next three do not read.
    expect(stdout).toContain("exhausted=5");
    // A thumbnail present reports true, and an absent one false.
    expect(stdout).toContain("hasArtwork=True,False");
    // An AUMID with no registered DisplayName is its own display name.
    expect(stdout).toContain("appFallback=yunari-no-such-aumid.exe");
  }, 30_000);
});
