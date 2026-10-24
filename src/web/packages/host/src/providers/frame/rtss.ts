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
 * The RTSS structs as the runtime marshaler lays them out.
 *
 * The field order and types mirror `RTSSSharedMemory.h` (SDK v2.21); no byte
 * offset is summed here. `Layout()` exposes the marshaler's own offsets so a
 * test can pin them to an independent golden table. `dwStatFrameTimeBuf` is the
 * 1024-slot ring of recent frames in microseconds; the shipped
 * `OverlayDataProviderInternal.cpp` reads it as `buf[(i + pos) & 1023]`, so the
 * newest frame is `(pos - 1) & 1023` and `pos` is the next slot to overwrite.
 *
 * The header's own `dwAppEntrySize`/`dwAppArrOffset`/`dwAppArrSize` drive
 * traversal, so a version that appends fields does not move a field read here.
 * C# 5 only: PowerShell 5.1's Add-Type compiler is not a modern Roslyn.
 */
export const RTSS_INTEROP_SOURCE = `
using System;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;

public static class YunariRtss {
  public const int StatusOk = 0;
  public const int StatusNotRunning = 1;
  public const int StatusTooSmall = 2;
  public const int StatusSignature = 3;
  public const int StatusVersion = 4;
  public const int StatusLayout = 5;
  public const uint Signature = (uint)'R' | ((uint)'T' << 8) | ((uint)'S' << 16) | ((uint)'S' << 24);

  [StructLayout(LayoutKind.Sequential)]
  public struct Header {
    public uint dwSignature;
    public uint dwVersion;
    public uint dwAppEntrySize;
    public uint dwAppArrOffset;
    public uint dwAppArrSize;
    public uint dwOSDEntrySize;
    public uint dwOSDArrOffset;
    public uint dwOSDArrSize;
    public uint dwOSDFrame;
    public int dwBusy;
    public uint dwDesktopVideoCaptureFlags;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 5)] public uint[] dwDesktopVideoCaptureStat;
    public uint dwLastForegroundApp;
    public uint dwLastForegroundAppProcessID;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct AppEntry {
    public uint dwProcessID;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 260)] public byte[] szName;
    public uint dwFlags;
    public uint dwTime0;
    public uint dwTime1;
    public uint dwFrames;
    public uint dwFrameTime;
    public uint dwStatFlags;
    public uint dwStatTime0;
    public uint dwStatTime1;
    public uint dwStatFrames;
    public uint dwStatCount;
    public uint dwStatFramerateMin;
    public uint dwStatFramerateAvg;
    public uint dwStatFramerateMax;
    public uint dwOSDX;
    public uint dwOSDY;
    public uint dwOSDPixel;
    public uint dwOSDColor;
    public uint dwOSDFrame;
    public uint dwScreenCaptureFlags;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 260)] public byte[] szScreenCapturePath;
    public uint dwOSDBgndColor;
    public uint dwVideoCaptureFlags;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 260)] public byte[] szVideoCapturePath;
    public uint dwVideoFramerate;
    public uint dwVideoFramesize;
    public uint dwVideoFormat;
    public uint dwVideoQuality;
    public uint dwVideoCaptureThreads;
    public uint dwScreenCaptureQuality;
    public uint dwScreenCaptureThreads;
    public uint dwAudioCaptureFlags;
    public uint dwVideoCaptureFlagsEx;
    public uint dwAudioCaptureFlags2;
    public uint dwStatFrameTimeMin;
    public uint dwStatFrameTimeAvg;
    public uint dwStatFrameTimeMax;
    public uint dwStatFrameTimeCount;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 1024)] public uint[] dwStatFrameTimeBuf;
    public uint dwStatFrameTimeBufPos;
    public uint dwStatFrameTimeBufFramerate;
  }

  public sealed class Snapshot {
    public int Status;
    public uint Version;
    public bool HasApp;
    public uint Pid;
    public string App = "";
    public uint RingPos;
    public uint[] Ring = new uint[0];
  }

  public static byte[] Read(string name) {
    try {
      using (var map = MemoryMappedFile.OpenExisting(name)) {
        using (var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read)) {
          long length = view.Capacity;
          if (length <= 0 || length > 67108864) return null;
          var bytes = new byte[length];
          view.ReadArray(0, bytes, 0, bytes.Length);
          return bytes;
        }
      }
    } catch { return null; }
  }

  public static Snapshot Decode(byte[] map) {
    Snapshot snapshot = new Snapshot();
    snapshot.Status = StatusNotRunning;
    if (map == null) return snapshot;

    int headerSize = Marshal.SizeOf(typeof(Header));
    if (map.Length < headerSize) { snapshot.Status = StatusTooSmall; return snapshot; }

    Header header = BytesToStruct<Header>(map);
    snapshot.Version = header.dwVersion;
    if (header.dwSignature != Signature) { snapshot.Status = StatusSignature; return snapshot; }
    if (header.dwVersion < 0x00020000) { snapshot.Status = StatusVersion; return snapshot; }

    int entrySize = Marshal.SizeOf(typeof(AppEntry));
    if (header.dwAppEntrySize < (uint)entrySize) { snapshot.Status = StatusLayout; return snapshot; }
    if (header.dwAppArrOffset == 0 || header.dwAppArrSize == 0 || header.dwAppArrSize > 4096) {
      snapshot.Status = StatusLayout;
      return snapshot;
    }

    bool tryForeground = header.dwVersion >= 0x00020016;
    int active = -1;
    uint activePid = 0;
    uint bestTime = 0;
    AppEntry activeEntry = new AppEntry();

    for (uint i = 0; i < header.dwAppArrSize; i++) {
      long offset = (long)header.dwAppArrOffset + (long)i * header.dwAppEntrySize;
      if (offset + entrySize > map.Length) break;

      byte[] slice = new byte[entrySize];
      Array.Copy(map, (int)offset, slice, 0, entrySize);
      AppEntry entry = BytesToStruct<AppEntry>(slice);
      if (entry.dwProcessID == 0) continue;

      if (tryForeground && entry.dwProcessID == header.dwLastForegroundAppProcessID) {
        active = (int)offset;
        activePid = entry.dwProcessID;
        activeEntry = entry;
        break;
      }

      if (active < 0 || entry.dwTime1 > bestTime) {
        active = (int)offset;
        activePid = entry.dwProcessID;
        bestTime = entry.dwTime1;
        activeEntry = entry;
      }
    }

    snapshot.Status = StatusOk;
    if (active < 0) return snapshot;

    snapshot.HasApp = true;
    snapshot.Pid = activePid;
    snapshot.App = NameOf(activeEntry.szName);
    snapshot.RingPos = activeEntry.dwStatFrameTimeBufPos;
    snapshot.Ring = activeEntry.dwStatFrameTimeBuf;
    return snapshot;
  }

  public static int NewestIndex(uint pos) { return (int)((pos - 1) & 1023); }

  public static uint[] FramesSince(uint[] ring, uint pos, int lastNewest) {
    if (ring == null || ring.Length < 1024 || lastNewest < 0 || lastNewest > 1023) {
      return new uint[0];
    }

    int newest = NewestIndex(pos);
    if (newest == lastNewest) return new uint[0];

    int steps = (newest - lastNewest + 1024) % 1024;
    uint[] frames = new uint[steps];
    int kept = 0;
    for (int k = 1; k <= steps; k++) {
      uint microseconds = ring[(lastNewest + k) & 1023];
      // Zero is an uninitialised slot; over a second is not a frame.
      if (microseconds == 0 || microseconds > 1000000) continue;
      frames[kept] = microseconds;
      kept += 1;
    }

    uint[] result = new uint[kept];
    Array.Copy(frames, result, kept);
    return result;
  }

  public static string[] Layout() {
    return new string[] {
      "dwVersion=" + ((int)Marshal.OffsetOf(typeof(Header), "dwVersion")),
      "dwAppEntrySize=" + ((int)Marshal.OffsetOf(typeof(Header), "dwAppEntrySize")),
      "dwAppArrOffset=" + ((int)Marshal.OffsetOf(typeof(Header), "dwAppArrOffset")),
      "dwAppArrSize=" + ((int)Marshal.OffsetOf(typeof(Header), "dwAppArrSize")),
      "dwLastForegroundAppProcessID=" + ((int)Marshal.OffsetOf(typeof(Header), "dwLastForegroundAppProcessID")),
      "dwProcessID=" + ((int)Marshal.OffsetOf(typeof(AppEntry), "dwProcessID")),
      "szName=" + ((int)Marshal.OffsetOf(typeof(AppEntry), "szName")),
      "dwTime1=" + ((int)Marshal.OffsetOf(typeof(AppEntry), "dwTime1")),
      "dwStatFrameTimeBuf=" + ((int)Marshal.OffsetOf(typeof(AppEntry), "dwStatFrameTimeBuf")),
      "dwStatFrameTimeBufPos=" + ((int)Marshal.OffsetOf(typeof(AppEntry), "dwStatFrameTimeBufPos")),
      "dwStatFrameTimeBufFramerate=" + ((int)Marshal.OffsetOf(typeof(AppEntry), "dwStatFrameTimeBufFramerate")),
      "headerSize=" + Marshal.SizeOf(typeof(Header)),
      "entrySize=" + Marshal.SizeOf(typeof(AppEntry))
    };
  }

  private static T BytesToStruct<T>(byte[] bytes) where T : struct {
    GCHandle handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
    try {
      return (T)Marshal.PtrToStructure(handle.AddrOfPinnedObject(), typeof(T));
    } finally {
      handle.Free();
    }
  }

  private static string NameOf(byte[] raw) {
    int length = raw.Length;
    for (int i = 0; i < raw.Length; i++) {
      if (raw[i] == 0) { length = i; break; }
    }
    string name = Encoding.ASCII.GetString(raw, 0, length).Trim();
    try { return Path.GetFileName(name); } catch { return name; }
  }
}
`;

const RTSS_INTEROP = `
$Interop = @'
${RTSS_INTEROP_SOURCE}
'@
$InteropReady = $false
try { Add-Type -TypeDefinition $Interop -Language CSharp -ErrorAction Stop; $InteropReady = $true } catch { }
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

$reportedDown = $false
$lastPid = 0
$lastNewest = -1
$polls = 0

while ($true) {
  $bytes = $null
  if ($InteropReady) {
    try { $bytes = [YunariRtss]::Read($MapName) } catch { $bytes = $null }
  }

  $snapshot = $null
  $reason = $null
  if (-not $InteropReady) {
    $reason = 'The RTSS shared-memory reader could not be compiled.'
  } elseif ($null -eq $bytes) {
    $reason = 'RivaTuner Statistics Server is not running.'
  } else {
    try { $snapshot = [YunariRtss]::Decode($bytes) } catch { $snapshot = $null }
    if ($null -eq $snapshot) {
      $reason = 'RTSS shared memory could not be read.'
    } elseif ($snapshot.Status -eq [YunariRtss]::StatusTooSmall) {
      $reason = 'RTSS shared memory is too small to read.'
    } elseif ($snapshot.Status -eq [YunariRtss]::StatusSignature) {
      $reason = 'RTSS shared memory has an unexpected signature.'
    } elseif ($snapshot.Status -eq [YunariRtss]::StatusVersion) {
      $reason = 'RTSS shared memory is older than version 2.0.'
    } elseif ($snapshot.Status -eq [YunariRtss]::StatusLayout) {
      $reason = 'RTSS shared memory has an unexpected application entry layout.'
    } elseif ($snapshot.Status -ne [YunariRtss]::StatusOk) {
      $reason = 'RivaTuner Statistics Server is not running.'
    }
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

    if ($snapshot.HasApp) {
      $newest = [YunariRtss]::NewestIndex($snapshot.RingPos)

      if ($snapshot.Pid -ne $lastPid) {
        # A new process or the first poll: the ring may predate us or hold
        # another game's frames, so only frames observed from now on count.
        $lastPid = $snapshot.Pid
        $lastNewest = $newest
      } else {
        $frames = [YunariRtss]::FramesSince($snapshot.Ring, $snapshot.RingPos, $lastNewest)
        foreach ($microseconds in $frames) {
          $text = ([double]$microseconds / 1000.0).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
          if ($snapshot.App -eq '') {
            [Console]::Out.WriteLine('{"kind":"frame","frametimeMs":' + $text + '}')
          } else {
            # szName is an executable name, not a path; Windows forbids
            # quotes and backslashes in one, so it needs no JSON escaping.
            [Console]::Out.WriteLine('{"kind":"frame","frametimeMs":' + $text + ',"app":"' + $snapshot.App + '"}')
          }
          $emitted = $true
        }
        $lastNewest = $newest
      }
    } else {
      $lastPid = 0
      $lastNewest = -1
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
