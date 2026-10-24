import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseSmtcLine,
  SMTC_SCRIPT,
  type SmtcSession,
  smtcArtworkLine,
  smtcScript,
} from "./smtc-helper.js";

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

  it("selects the generic AsTask overload, never the IAsyncAction one", () => {
    // The non-generic overload has the same arity; binding it first makes
    // MakeGenericMethod throw. Only the generic definition is usable here.
    expect(SMTC_SCRIPT).toContain("$_.IsGenericMethodDefinition");
    expect(SMTC_SCRIPT).toContain("MakeGenericMethod");
    expect(SMTC_SCRIPT).not.toContain(
      "[System.WindowsRuntimeSystemExtensions]::AsTask",
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
  const artworkLine = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      kind: "artwork",
      sessionId: "Spotify.exe",
      sha256,
      ext: "png",
      base64: Buffer.from(bytes).toString("base64"),
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
      sessionLine(),
    ];

    for (const line of malformed) {
      expect(() => smtcArtworkLine(line), line).not.toThrow();
      expect(smtcArtworkLine(line), line).toBeUndefined();
    }
  });
});
