import {
  type HelperExitKind,
  type KillTree,
  type SpawnProcess,
  startJsonLineHelper,
} from "../helpers/supervisor.js";

/**
 * Frame timing from RivaTuner Statistics Server's shared memory.
 *
 * RTSS is a third-party overlay that hooks the game; this adapter never starts
 * it, injects into anything, or reads a file it does not publish. When RTSS is
 * not running the helper says so once and the provider reports `unavailable`.
 * PresentMon is the fallback adapter the plan adds separately (task 6.2).
 */

export interface FrameReading {
  readonly fps: number;
  readonly frametimeMs: number;
  readonly app: string;
}

export interface FrameAdapter {
  readonly id: "rtss" | "presentmon";
  start(
    onReading: (reading: FrameReading) => void,
    onUnavailable: (reason: string) => void,
  ): () => void;
}

/** Reported verbatim by the script, and named in tests. */
export const RTSS_NOT_RUNNING = "RivaTuner Statistics Server is not running.";

/** A line the script emits once per absence episode, then keeps polling. */
const KIND_UNAVAILABLE = "unavailable";
const KIND_FRAME = "frame";

/** A helper that stops emitting heartbeats for this long is wedged. */
const LIVENESS_TIMEOUT_MS = 15_000;

/**
 * The app-entry offsets, in bytes, from `RTSSSharedMemory.h` (SDK v2.21):
 * the declared field order, not a guess. The header's own `dwAppEntrySize`,
 * `dwAppArrOffset` and `dwAppArrSize` are read for traversal, so a version
 * that appends fields does not move any field read here.
 *
 * `dwStatFrameTimeBuf` is the 1024-entry ring of the last frames in
 * microseconds. `OverlayDataProviderInternal.cpp` reads it as
 * `buf[(i + dwStatFrameTimeBufPos) & 1023]`, so the newest frame is
 * `(pos - 1) & 1023` and `pos` is the next slot to overwrite.
 */
const RTSS_OFFSETS = `
# RTSS_SHARED_MEMORY_HEADER
$HeaderVersion = 4
$HeaderAppEntrySize = 8
$HeaderAppArrOffset = 12
$HeaderAppArrSize = 16
$HeaderForegroundPid = 68
# RTSS_SHARED_MEMORY_APP_ENTRY
$AppProcessId = 0
$AppName = 4
$AppNameMax = 260
$AppTime1 = 272
$AppStatFrameTimeBuf = 924
$AppStatFrameTimeBufPos = 5024
$RingSize = 1024
$EntryNeed = 5028
$HeaderNeed = 72
`;

const RTSS_INTEROP = `
$Interop = @'
using System;
using System.IO.MemoryMappedFiles;
public static class YunariRtss {
  public static byte[] Read(string name) {
    try {
      using (var map = MemoryMappedFile.OpenExisting(name)) {
        using (var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read)) {
          long length = view.Capacity;
          if (length < 72 || length > 67108864) return null;
          var bytes = new byte[length];
          view.ReadArray(0, bytes, 0, bytes.Length);
          return bytes;
        }
      }
    } catch { return null; }
  }
}
'@
try { Add-Type -TypeDefinition $Interop -Language CSharp } catch { }
`;

/**
 * One JSON line per newly observed frame, an `idle` heartbeat once a second,
 * and one `unavailable` line per absence. The script waits for RTSS rather
 * than launching it; the adapter stops it when it is no longer needed.
 */
const RTSS_LOOP = `
$MapName = 'RTSSSharedMemoryV2'
$PollMs = 100
$HeartbeatPolls = 10
$Invalid = 1000000

function Read-U32([byte[]]$bytes, [int]$offset) {
  return [BitConverter]::ToUInt32($bytes, $offset)
}

$reportedDown = $false
$lastPid = 0
$lastNewest = -1
$polls = 0

while ($true) {
  $bytes = $null
  try { $bytes = [YunariRtss]::Read($MapName) } catch { $bytes = $null }

  $reason = $null
  if ($null -eq $bytes) {
    $reason = 'RivaTuner Statistics Server is not running.'
  } elseif ($bytes.Length -lt $HeaderNeed) {
    $reason = 'RTSS shared memory is too small to read.'
  } elseif ([Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RTSS') {
    $reason = 'RTSS shared memory has an unexpected signature.'
  } elseif ((Read-U32 $bytes $HeaderVersion) -lt 0x00020000) {
    $reason = 'RTSS shared memory is older than version 2.0.'
  }

  $emitted = $false

  if ($null -ne $reason) {
    if (-not $reportedDown) {
      [Console]::Out.WriteLine('{"kind":"unavailable","reason":"' + $reason + '"}')
      $reportedDown = $true
      $emitted = $true
    }
    $lastPid = 0
    $lastNewest = -1
  } else {
    $reportedDown = $false
    $entrySize = Read-U32 $bytes $HeaderAppEntrySize
    $arrOffset = Read-U32 $bytes $HeaderAppArrOffset
    $arrSize = Read-U32 $bytes $HeaderAppArrSize
    $foregroundPid = Read-U32 $bytes $HeaderForegroundPid

    $active = -1
    $activePid = 0
    $bestTime = 0

    if ($entrySize -ge $EntryNeed -and $arrOffset -gt 0 -and $arrSize -gt 0 -and $arrSize -le 4096) {
      for ($i = 0; $i -lt $arrSize; $i++) {
        $entry = $arrOffset + ($i * $entrySize)
        if (($entry + $EntryNeed) -gt $bytes.Length) { break }
        $pidValue = Read-U32 $bytes ($entry + $AppProcessId)
        if ($pidValue -eq 0) { continue }
        if ($pidValue -eq $foregroundPid) {
          $active = $entry
          $activePid = $pidValue
          break
        }
        $time1 = Read-U32 $bytes ($entry + $AppTime1)
        if ($active -lt 0 -or $time1 -gt $bestTime) {
          $active = $entry
          $activePid = $pidValue
          $bestTime = $time1
        }
      }
    }

    $app = ''
    if ($active -ge 0) {
      $raw = [Text.Encoding]::ASCII.GetString($bytes, $active + $AppName, $AppNameMax)
      $nul = $raw.IndexOf([char]0)
      if ($nul -ge 0) { $raw = $raw.Substring(0, $nul) }
      # szName is an executable name, not a path; Windows forbids quotes and
      # backslashes in one, so it needs no JSON escaping.
      $app = [IO.Path]::GetFileName($raw.Trim())
    }

    if ($active -ge 0 -and $activePid -ne 0) {
      $pos = (Read-U32 $bytes ($active + $AppStatFrameTimeBufPos)) -band ($RingSize - 1)
      $newest = ($pos - 1) -band ($RingSize - 1)

      if ($activePid -ne $lastPid) {
        # A new process or the first poll: the ring may predate us or hold
        # another game's frames, so only frames observed from now on count.
        $lastPid = $activePid
        $lastNewest = $newest
      } elseif ($newest -ne $lastNewest) {
        $steps = ($newest - $lastNewest + $RingSize) % $RingSize
        for ($k = 1; $k -le $steps; $k++) {
          $index = ($lastNewest + $k) % $RingSize
          $microseconds = [int64](Read-U32 $bytes ($active + $AppStatFrameTimeBuf + ($index * 4)))
          # A zero is an uninitialised slot; over a second is not a frame.
          if ($microseconds -le 0 -or $microseconds -gt $Invalid) { continue }
          $text = ([double]$microseconds / 1000.0).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
          if ($app -eq '') {
            [Console]::Out.WriteLine('{"kind":"frame","frametimeMs":' + $text + '}')
          } else {
            [Console]::Out.WriteLine('{"kind":"frame","frametimeMs":' + $text + ',"app":"' + $app + '"}')
          }
          $emitted = $true
        }
        $lastNewest = $newest
      }
    }
  }

  $polls = $polls + 1
  if (-not $emitted -and ($polls % $HeartbeatPolls) -eq 0) {
    [Console]::Out.WriteLine('{"kind":"idle"}')
  }
  Start-Sleep -Milliseconds $PollMs
}
`;

export function rtssScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    RTSS_OFFSETS,
    RTSS_INTEROP,
    RTSS_LOOP,
  ].join("\n");
}

function parseObject(line: string): Record<string, unknown> | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  return parsed as Record<string, unknown>;
}

/**
 * One helper line. An absent app is "", which the provider reads as "no name"
 * rather than inventing one; a malformed or non-frame line is not a reading.
 */
export function parseFrameLine(line: string): FrameReading | undefined {
  const record = parseObject(line);

  if (record === undefined || record["kind"] !== KIND_FRAME) return undefined;

  const frametimeMs = record["frametimeMs"];
  const app = record["app"];

  if (
    typeof frametimeMs !== "number" ||
    !Number.isFinite(frametimeMs) ||
    frametimeMs <= 0
  ) {
    return undefined;
  }

  if (app !== undefined && typeof app !== "string") return undefined;

  return {
    fps: 1000 / frametimeMs,
    frametimeMs,
    app: app ?? "",
  };
}

/** The reason from an `unavailable` line, or undefined for any other line. */
export function parseFrameUnavailable(line: string): string | undefined {
  const record = parseObject(line);

  if (record === undefined || record["kind"] !== KIND_UNAVAILABLE) {
    return undefined;
  }

  const reason = record["reason"];
  return typeof reason === "string" && reason.trim() !== ""
    ? reason
    : undefined;
}

export interface RtssAdapterOptions {
  readonly spawnProcess?: SpawnProcess;
  readonly killTree?: KillTree;
  readonly pathExists?: (file: string) => boolean;
}

/** Opens and closes the RTSS helper; the provider owns when that happens. */
export class RtssAdapter implements FrameAdapter {
  readonly id = "rtss" as const;

  readonly #spawnProcess: SpawnProcess | undefined;
  readonly #killTree: KillTree | undefined;
  readonly #pathExists: ((file: string) => boolean) | undefined;

  constructor(options: RtssAdapterOptions = {}) {
    this.#spawnProcess = options.spawnProcess;
    this.#killTree = options.killTree;
    this.#pathExists = options.pathExists;
  }

  start(
    onReading: (reading: FrameReading) => void,
    onUnavailable: (reason: string) => void,
  ): () => void {
    const handle = startJsonLineHelper({
      id: "rtss",
      script: rtssScript(),
      timeoutMs: LIVENESS_TIMEOUT_MS,
      ...(this.#spawnProcess === undefined
        ? {}
        : { spawnProcess: this.#spawnProcess }),
      ...(this.#killTree === undefined ? {} : { killTree: this.#killTree }),
      ...(this.#pathExists === undefined
        ? {}
        : { pathExists: this.#pathExists }),
      onLine: (line) => {
        const reading = parseFrameLine(line);
        if (reading !== undefined) {
          onReading(reading);
          return;
        }

        const reason = parseFrameUnavailable(line);
        if (reason !== undefined) onUnavailable(reason);
      },
      onExit: (reason: string, kind: HelperExitKind) => {
        // A deliberate stop is the provider's own teardown.
        if (kind !== "stopped") onUnavailable(reason);
      },
    });

    return () => handle.stop();
  }
}
