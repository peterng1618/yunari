import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { powershellPath } from "../helpers/supervisor.js";
import { RTSS_INTEROP_SOURCE } from "./rtss.js";

/**
 * The RTSS layout, proved against the runtime marshaler rather than against
 * numbers the script also carries. The golden table below is the compiler
 * offset probe from the SDK header (`RTSSSharedMemory.h`, v2.21); it is
 * deliberately independent of `rtss.ts`.
 *
 * Windows-only: Add-Type needs PowerShell 5.1. A non-Windows checkout skips
 * rather than fails, like the SMTC helper's real-path test.
 */
const available =
  process.platform === "win32" && powershellPath() !== undefined;

const GOLDEN_LAYOUT = [
  "dwVersion=4",
  "dwAppEntrySize=8",
  "dwAppArrOffset=12",
  "dwAppArrSize=16",
  "dwLastForegroundAppProcessID=68",
  "dwProcessID=0",
  "szName=4",
  "dwTime1=272",
  "dwStatFrameTimeBuf=924",
  "dwStatFrameTimeBufPos=5020",
  "dwStatFrameTimeBufFramerate=5024",
  "headerSize=72",
  "entrySize=5028",
];

/** The entry size the structs declare; the synthetic map uses the same. */
const ENTRY_SIZE = 5_028;
const ARR_OFFSET = 96;

const OFF_PID = 0;
const OFF_NAME = 4;
const OFF_TIME1 = 272;
const OFF_RING = 924;
const OFF_POS = 5_020;

function entryBase(index: number): number {
  return ARR_OFFSET + index * ENTRY_SIZE;
}

/** Header + three app entries, one ring wrapped across slot 1023. */
function syntheticMap(): Buffer {
  const map = Buffer.alloc(entryBase(3) + 16);
  const u32 = (offset: number, value: number): void => {
    map.writeUInt32LE(value, offset);
  };
  const ring = (index: number, slot: number, value: number): void => {
    u32(entryBase(index) + OFF_RING + slot * 4, value);
  };
  const name = (index: number, value: string): void => {
    Buffer.from(value, "ascii").copy(map, entryBase(index) + OFF_NAME);
  };

  // RTSS_SHARED_MEMORY_HEADER: two trailing uint[]s are skipped.
  u32(0, 0x53535452); // 'RTSS'
  u32(4, 0x00020016); // v2.16: the foreground PID field is valid
  u32(8, ENTRY_SIZE);
  u32(12, ARR_OFFSET);
  u32(16, 3);
  u32(68, 3333); // last foreground process

  // 0: background, not selected.
  u32(entryBase(0) + OFF_PID, 1111);
  name(0, "background.exe");
  u32(entryBase(0) + OFF_TIME1, 500);

  // 1: most recent dwTime1, so it wins if foreground selection misses.
  u32(entryBase(1) + OFF_PID, 2222);
  name(1, "newer.exe");
  u32(entryBase(1) + OFF_TIME1, 900);
  u32(entryBase(1) + OFF_POS, 3);

  // 2: the foreground app, with an older dwTime1 than entry 1.
  u32(entryBase(2) + OFF_PID, 3333);
  name(2, "game.exe");
  u32(entryBase(2) + OFF_TIME1, 100);
  u32(entryBase(2) + OFF_POS, 3);
  ring(2, 1_023, 7_000);
  ring(2, 0, 9_000);
  ring(2, 1, 0); // empty slot: must not become a frame
  ring(2, 2, 11_000);

  return map;
}

function testScript(): string {
  return `param([string]$Mode, [string]$MapPath, [int]$LastNewest)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Interop = @'
${RTSS_INTEROP_SOURCE}
'@
Add-Type -TypeDefinition $Interop -Language CSharp -ErrorAction Stop

if ($Mode -eq 'layout') {
  foreach ($row in [YunariRtss]::Layout()) { [Console]::Out.WriteLine($row) }
  exit 0
}

$map = [IO.File]::ReadAllBytes($MapPath)
$snapshot = [YunariRtss]::Decode($map)
$frames = [YunariRtss]::FramesSince($snapshot.Ring, $snapshot.RingPos, $LastNewest)
$out = [ordered]@{
  status = $snapshot.Status
  version = $snapshot.Version
  hasApp = $snapshot.HasApp
  pid = $snapshot.Pid
  app = $snapshot.App
  ringPos = $snapshot.RingPos
  ring1023 = $snapshot.Ring[1023]
  ring0 = $snapshot.Ring[0]
  ring1 = $snapshot.Ring[1]
  ring2 = $snapshot.Ring[2]
  frames = @($frames)
}
[Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
`;
}

interface Run {
  readonly lines: readonly string[];
  readonly failure?: string;
}

function runPowerShell(mode: string, mapPath = "", lastNewest = 0): Run {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yunari-rtss-"));
  const scriptPath = path.join(directory, "probe.ps1");
  fs.writeFileSync(scriptPath, testScript(), "utf8");

  try {
    const executable = powershellPath();

    if (executable === undefined)
      return { lines: [], failure: "no PowerShell" };

    const result = spawnSync(
      executable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        mode,
        mapPath,
        String(lastNewest),
      ],
      { encoding: "utf8", timeout: 60_000 },
    );

    if (result.error !== undefined) {
      return { lines: [], failure: result.error.message };
    }
    if (result.status !== 0) {
      return {
        lines: [],
        failure: `exit ${String(result.status)}: ${result.stderr.trim()}`,
      };
    }

    return {
      lines: result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe.skipIf(!available)("RTSS layout and traversal on Windows", () => {
  it("marshals every read field at the SDK's independently probed offset", () => {
    const run = runPowerShell("layout");

    expect(run.failure).toBeUndefined();
    expect(run.lines).toEqual(GOLDEN_LAYOUT);
  });

  it("selects the foreground app and steps a wrapped ring past an empty slot", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "yunari-rtss-map-"),
    );
    const mapPath = path.join(directory, "synthetic.bin");
    fs.writeFileSync(mapPath, syntheticMap());

    try {
      const run = runPowerShell("decode", mapPath, 1_022);

      expect(run.failure).toBeUndefined();
      expect(run.lines).toHaveLength(1);

      const decoded = JSON.parse(run.lines[0] ?? "{}") as Record<
        string,
        unknown
      >;

      expect(decoded).toMatchObject({
        status: 0,
        version: 0x00020016,
        hasApp: true,
        // Entry 1 has the newer dwTime1, so a traversal bound that stops
        // before the last entry would pick 2222/newer.exe instead.
        pid: 3333,
        app: "game.exe",
        ringPos: 3,
        ring1023: 7_000,
        ring0: 9_000,
        ring1: 0,
        ring2: 11_000,
        // Newest is (3 - 1) & 1023 = 2; slots 1023, 0, 1, 2 are new, and
        // the empty slot 1 is not a frame.
        frames: [7_000, 9_000, 11_000],
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
