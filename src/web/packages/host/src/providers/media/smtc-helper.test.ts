import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  HELPER_LINE_CAP,
  type HelperChild,
  type SpawnProcess,
  startJsonLineHelper,
} from "../helpers/supervisor.js";
import {
  parseSmtcLine,
  SMTC_ARTWORK_ENVELOPE_RESERVE,
  SMTC_ARTWORK_RAW_BYTES,
  SMTC_SCRIPT,
  type SmtcSession,
  smtcArtworkLine,
  smtcScript,
} from "./smtc-helper.js";

class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function fakeSpawner(): {
  spawnProcess: SpawnProcess;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  let pid = 300;

  return {
    children,
    spawnProcess: (() => {
      const child = new FakeChild(pid);
      pid += 1;
      children.push(child);
      return child as unknown as HelperChild;
    }) as SpawnProcess,
  };
}

function base64Length(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/** The JSON around the payload: keys, session id, digest, extension. */
function artworkEnvelope(sessionId: string): number {
  return JSON.stringify({
    kind: "artwork",
    sessionId,
    sha256: "0".repeat(64),
    ext: "png",
    base64: "",
  }).length;
}

function sessionLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "session",
    app: "Spotify.exe",
    sessionId: "Spotify.exe",
    title: "Bài hát",
    artist: "Ca sĩ",
    album: "Album",
    state: "playing",
    positionS: 12.5,
    durationS: 200,
    ...overrides,
  });
}

const SESSION: SmtcSession = {
  title: "Bài hát",
  artist: "Ca sĩ",
  album: "Album",
  state: "playing",
  positionS: 12.5,
  durationS: 200,
  app: "Spotify.exe",
  sessionId: "Spotify.exe",
};

describe("SMTC_SCRIPT", () => {
  it("sets the UTF-8 output encoding before it writes anything", () => {
    const encoding = SMTC_SCRIPT.indexOf(
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    );
    const firstWrite = SMTC_SCRIPT.indexOf("[Console]::Out.WriteLine");

    expect(encoding).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(encoding);
  });

  it("selects the generic AsTask overload and actually closes it", () => {
    // The non-generic overload has the same arity; binding it first makes
    // MakeGenericMethod throw. Pin the executing call, not the word: the
    // comment above it mentions MakeGenericMethod too.
    expect(SMTC_SCRIPT).toContain("$_.IsGenericMethodDefinition");
    expect(SMTC_SCRIPT).toContain(
      "$task = $AsTaskMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))",
    );
  });

  it("reads artwork through the reflected DataReader constructor only when asked", () => {
    const artwork = smtcScript({ artwork: true });

    expect(artwork).toContain(
      "[Windows.Storage.Streams.DataReader].GetConstructor(@([Windows.Storage.Streams.IInputStream]))",
    );
    // DataReader has no constructor PowerShell can bind; the reflection is the
    // only path, and no poll may pay for artwork it was not asked for.
    expect(SMTC_SCRIPT).not.toContain("DataReader");
    expect(SMTC_SCRIPT).not.toContain("base64");
    expect(smtcScript()).not.toContain("DataReader");
  });

  it("bounds the async wait so a stuck load cannot wedge the helper", () => {
    const artwork = smtcScript({ artwork: true });

    expect(artwork).toContain("[DateTime]::UtcNow.AddSeconds(10)");
    expect(artwork).toContain("async operation did not finish");
  });

  it("accepts an image only when its trailer proves it was not truncated", () => {
    const artwork = smtcScript({ artwork: true });

    expect(artwork).toContain("'IEND'");
    expect(artwork).toContain("0xd9");
    expect(artwork).toContain("[BitConverter]::ToUInt32");
    expect(artwork).toContain("Test-CompleteImage $buffer $ext");
  });

  it("caches only over-cap and an exhausted retry count as a negative", () => {
    const artwork = smtcScript({ artwork: true });

    // Absent thumbnail and truncated image are retryable, not final.
    expect(artwork).toContain(
      "if ($null -eq $thumbnail) { return @{ status = 'retry' } }",
    );
    expect(artwork).toContain(
      "if (-not (Test-CompleteImage $buffer $ext)) { return @{ status = 'retry' } }",
    );
    // Over-cap is the one definitive answer.
    expect(artwork).toContain(
      `if ($chunks.Count -gt ${SMTC_ARTWORK_RAW_BYTES}) { return @{ status = 'over' } }`,
    );
    // Bounded retries: 5 attempts, about 5 s at one poll a second.
    expect(artwork).toContain("$ArtworkRetryLimit = 5");
    expect(artwork).toContain("$attempt['count'] -ge $ArtworkRetryLimit");

    const emit = artwork.indexOf(
      "[Console]::Out.WriteLine(($result['line'] | ConvertTo-Json -Compress))",
    );
    const record = artwork.indexOf("$lastArtwork[$sessionId] = $key");
    expect(emit).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(emit);
  });

  it("reads each session inside its own try, so one failure cannot hide others", () => {
    expect(SMTC_SCRIPT).toMatch(
      /foreach \(\$session in \$sessions\) \{\s*try \{/,
    );
  });

  it("derives the artwork byte cap from the supervisor's framing", () => {
    // The largest line the script can emit must survive the supervisor's cap.
    expect(
      base64Length(SMTC_ARTWORK_RAW_BYTES) + artworkEnvelope("x".repeat(200)),
    ).toBeLessThanOrEqual(HELPER_LINE_CAP);

    // One byte more breaks the reserved envelope, so the script refuses it
    // instead of emitting a line the supervisor would drop.
    expect(
      base64Length(SMTC_ARTWORK_RAW_BYTES + 1) + SMTC_ARTWORK_ENVELOPE_RESERVE,
    ).toBeGreaterThan(HELPER_LINE_CAP);
    expect(artworkEnvelope("x".repeat(200))).toBeLessThanOrEqual(
      SMTC_ARTWORK_ENVELOPE_RESERVE,
    );

    expect(smtcScript({ artwork: true })).toContain(
      `if ($chunks.Count -gt ${SMTC_ARTWORK_RAW_BYTES}) { return @{ status = 'over' } }`,
    );
  });

  it("emits its largest artwork line through the real supervisor framing", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onLine = vi.fn();
    const onProblem = vi.fn();
    const killTree = vi.fn();

    startJsonLineHelper({
      id: "media",
      script: "x",
      pathExists: () => true,
      spawnProcess,
      killTree,
      onLine,
      onProblem,
      onExit: () => undefined,
    });

    const base64 = Buffer.alloc(SMTC_ARTWORK_RAW_BYTES).toString("base64");
    const line = JSON.stringify({
      kind: "artwork",
      sessionId: "x".repeat(200),
      sha256: "0".repeat(64),
      ext: "png",
      base64,
    });

    expect(line.length).toBeLessThanOrEqual(HELPER_LINE_CAP);
    children[0]?.stdout.emit("data", `${line}\n`);
    expect(onLine).toHaveBeenCalledWith(line);
    expect(onProblem).not.toHaveBeenCalled();
  });

  it("polls once a second", () => {
    expect(SMTC_SCRIPT).toContain("Start-Sleep -Milliseconds 1000");
  });
});

describe("parseSmtcLine", () => {
  it("parses a full metadata line and turns a null album into an empty string", () => {
    expect(parseSmtcLine(sessionLine())).toEqual(SESSION);
    expect(parseSmtcLine(sessionLine({ album: null }))).toEqual({
      ...SESSION,
      album: "",
    });
  });

  it("maps the three known states and treats anything else as stopped", () => {
    expect(parseSmtcLine(sessionLine({ state: "playing" }))?.state).toBe(
      "playing",
    );
    expect(parseSmtcLine(sessionLine({ state: "paused" }))?.state).toBe(
      "paused",
    );
    expect(parseSmtcLine(sessionLine({ state: "stopped" }))?.state).toBe(
      "stopped",
    );
    expect(parseSmtcLine(sessionLine({ state: "buffering" }))?.state).toBe(
      "stopped",
    );
  });

  it("returns undefined for malformed or adversarial lines and never throws", () => {
    const nonSessions = [
      "",
      " ",
      "not json",
      "null",
      "[]",
      "42",
      '"a string"',
      "{}",
      '{"kind":"none"}',
      '["kind","session"]',
      '{"kind":"session"}',
      sessionLine({ app: 7 }),
      sessionLine({ sessionId: null }),
      sessionLine({ title: 1 }),
      sessionLine({ positionS: "12" }),
      sessionLine({ durationS: null }),
      sessionLine({ positionS: -1 }),
      sessionLine({ durationS: Number.POSITIVE_INFINITY }),
      '{"kind":"session","app":"a","sessionId":"s","title":null,"artist":null,"album":null,"state":"playing","positionS":"NaN","durationS":1}',
    ];

    for (const line of nonSessions) {
      expect(() => parseSmtcLine(line), line).not.toThrow();
      expect(parseSmtcLine(line), line).toBeUndefined();
    }
  });

  it("reads a session with no album or title as empty strings, not undefined", () => {
    const parsed = parseSmtcLine(
      sessionLine({ title: null, artist: null, album: null }),
    );
    expect(parsed).toEqual({ ...SESSION, title: "", artist: "", album: "" });
  });
});

describe("smtcArtworkLine", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 250]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base64 = Buffer.from(bytes).toString("base64");
  const artworkLine = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      kind: "artwork",
      sessionId: "Spotify.exe",
      sha256,
      ext: "png",
      base64,
      ...overrides,
    });

  it("carries the digest, extension and bytes", () => {
    expect(smtcArtworkLine(artworkLine())).toEqual({
      sha256,
      bytes,
      ext: "png",
    });
  });

  it("accepts the four artwork extensions", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      expect(smtcArtworkLine(artworkLine({ ext }))?.ext, ext).toBe(ext);
    }
  });

  it("returns undefined for malformed lines and never throws", () => {
    const malformed: readonly string[] = [
      "",
      "not json",
      "null",
      "[]",
      '{"kind":"artwork"}',
      artworkLine({ sha256: undefined }),
      artworkLine({ sha256: "0".repeat(64) }),
      artworkLine({ sha256: sha256.toUpperCase() }),
      artworkLine({ sha256: sha256.slice(1) }),
      artworkLine({ ext: "exe" }),
      artworkLine({ ext: "" }),
      artworkLine({ base64: undefined }),
      artworkLine({ base64: "" }),
      artworkLine({ base64: "!!!not base64!!!" }),
      // Buffer.from tolerates all of these; none is the encoding it decodes to.
      artworkLine({ base64: `${base64.slice(0, 4)} ${base64.slice(4)}` }),
      artworkLine({ base64: `${base64.slice(0, 4)}\n${base64.slice(4)}` }),
      artworkLine({ base64: "AB==" }),
      artworkLine({ base64: "AQI" }),
      artworkLine({ base64: "AAAA====" }),
      artworkLine({ base64: "AA!C" }),
      sessionLine(),
    ];

    for (const line of malformed) {
      expect(() => smtcArtworkLine(line), line).not.toThrow();
      expect(smtcArtworkLine(line), line).toBeUndefined();
    }
  });
});
