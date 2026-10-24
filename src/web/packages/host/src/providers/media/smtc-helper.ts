import { createHash } from "node:crypto";
import { HELPER_LINE_CAP } from "../helpers/supervisor.js";

/**
 * Windows Now Playing through the SMTC session manager, read by one embedded
 * PowerShell script under the 0102 supervisor.
 *
 * Two things in that script are not guessable and are pinned by tests: the
 * WinRT awaits go through the *generic* `AsTask` overload (the non-generic
 * `IAsyncAction` one has the same arity and makes `MakeGenericMethod` throw),
 * and the output encoding is set before the first write (without it a
 * Vietnamese or CJK title arrives as mojibake through the pipe). The artwork
 * half additionally needs `DataReader`'s reflected constructor, because it has
 * no public constructor PowerShell can bind.
 */

export interface SmtcSession {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly state: "playing" | "paused" | "stopped";
  readonly positionS: number;
  readonly durationS: number;
  readonly app: string;
  readonly sessionId: string;
}

export interface ArtworkBytes {
  /** The AUMID of the session the picture belongs to, so a caller can refuse
   *  another session's art under the selected track's title. */
  readonly sessionId: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly ext: string;
}

export interface SmtcScriptOptions {
  /**
   * Emit a track's artwork bytes once, when the track changes. Off by default:
   * a display that does not bind `media.artwork` must not pay for decoding a
   * thumbnail on every track, and the supervisor's pipe carries no command
   * channel back into the script, so the caller asks by choosing this script.
   */
  readonly artwork?: boolean;
}

/**
 * The reflected `DataReader(IInputStream)` constructor. The type has no public
 * constructor PowerShell can bind; this is the only path to the bytes.
 */
const DATA_READER_CONSTRUCTOR =
  "[Windows.Storage.Streams.DataReader].GetConstructor(@([Windows.Storage.Streams.IInputStream]))";

/**
 * Room for the JSON keys, session id, digest and extension around the base64
 * payload. A Windows app id is well under this.
 */
export const SMTC_ARTWORK_ENVELOPE_RESERVE = 512;

/**
 * The largest raw image whose base64 JSON line still fits the supervisor's
 * framing: 4/3 expansion plus the envelope reserve. Derived rather than
 * guessed, so `SMTC_ARTWORK_RAW_BYTES + 1` is the first size the script must
 * refuse as a gap instead of emitting a line the supervisor would drop.
 */
export const SMTC_ARTWORK_RAW_BYTES = Math.floor(
  ((HELPER_LINE_CAP - SMTC_ARTWORK_ENVELOPE_RESERVE) * 3) / 4,
);

const HEADER = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]

# Only the generic AsTask overload can be closed with MakeGenericMethod.
$AsTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1
} | Select-Object -First 1

function Wait-WinRt($operation, [Type]$resultType) {
  if ($null -eq $AsTaskMethod) { throw 'no generic AsTask overload' }
  $task = $AsTaskMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}

function Convert-PlaybackState($playbackStatus) {
  $name = [string]$playbackStatus
  if ($name -eq 'Playing') { return 'playing' }
  if ($name -eq 'Paused') { return 'paused' }
  return 'stopped'
}

$AppNames = @{}
function Get-AppName($aumid) {
  if ($AppNames.ContainsKey($aumid)) { return $AppNames[$aumid] }
  $name = $aumid
  try {
    $key = "HKCU:\\Software\\Classes\\AppUserModelId\\$aumid"
    if (Test-Path $key) {
      $display = (Get-ItemProperty $key -ErrorAction Stop).DisplayName
      if (-not [string]::IsNullOrWhiteSpace($display)) { $name = $display }
    }
  } catch { }
  $AppNames[$aumid] = $name
  return $name
}

function Get-SessionLine($session, $isCurrent = $false) {
  $properties = Wait-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $playback = $session.GetPlaybackInfo()
  $state = Convert-PlaybackState $playback.PlaybackStatus
  $timeline = $session.GetTimelineProperties()
  $position = $timeline.Position.TotalSeconds
  if ($state -eq 'playing') {
    $position = $position + ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime.ToUniversalTime()).TotalSeconds
  }
  if ($position -lt 0) { $position = 0 }
  [ordered]@{
    kind = 'session'
    app = Get-AppName $session.SourceAppUserModelId
    sessionId = $session.SourceAppUserModelId
    title = $properties.Title
    artist = $properties.Artist
    album = $properties.AlbumTitle
    state = $state
    # Which session the system considers current, for the provider's choice
    # when nothing is playing.
    current = $isCurrent
    positionS = [math]::Round($position, 3)
    durationS = [math]::Round($timeline.EndTime.TotalSeconds, 3)
    # The artwork half reads this to tell "no thumbnail" from "broken emit".
    hasArtwork = ($null -ne $properties.Thumbnail)
  }
}
`;

/**
 * The audio half: the default render endpoint's volume and mute through
 * CoreAudio. No endpoint means neither key, never zero and unmuted. Compact
 * because the whole script travels as one `-EncodedCommand`, which Windows caps
 * near 32k characters; it is separate from `HEADER` so the artwork-only test
 * harness does not pay for the interop.
 */
const AUDIO = `
# Endpoint volume and mute through CoreAudio. No endpoint means neither key.
$AudioInterop = @'
using System;using System.Runtime.InteropServices;
public static class YunariAudio{
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class E{}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface N{[PreserveSig]int X0();[PreserveSig]int GetDefaultAudioEndpoint(int f,int r,out D d);}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface D{[PreserveSig]int Activate(ref Guid i,int c,IntPtr p,out V v);}
[ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface V{[PreserveSig]int X0();[PreserveSig]int X1();[PreserveSig]int X2();[PreserveSig]int X3();[PreserveSig]int X4();[PreserveSig]int X5();[PreserveSig]int GetMasterVolumeLevelScalar(out float l);[PreserveSig]int X7();[PreserveSig]int X8();[PreserveSig]int X9();[PreserveSig]int X10();[PreserveSig]int SetMute([MarshalAs(UnmanagedType.Bool)]bool m,IntPtr c);[PreserveSig]int GetMute([MarshalAs(UnmanagedType.Bool)]out bool m);}
static readonly Guid I=new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");const int C=23;
public static bool TryRead(out int v,out bool m){v=0;m=false;try{var n=(N)new E();D d;if(n.GetDefaultAudioEndpoint(0,1,out d)!=0||d==null)return false;Guid i=I;V a;if(d.Activate(ref i,C,IntPtr.Zero,out a)!=0||a==null)return false;float l;if(a.GetMasterVolumeLevelScalar(out l)!=0)return false;bool b;if(a.GetMute(out b)!=0)return false;v=(int)Math.Round(l*100.0);m=b;return true;}catch{return false;}}}
'@
$AudioAvailable = $false
try {
  Add-Type -TypeDefinition $AudioInterop -Language CSharp
  $AudioAvailable = $true
} catch {
  $AudioAvailable = $false
}

function Get-AudioLine {
  if (-not $AudioAvailable) { return [ordered]@{ kind = 'audio' } }
  $volume = 0
  $muted = $false
  if (-not [YunariAudio]::TryRead([ref]$volume, [ref]$muted)) {
    return [ordered]@{ kind = 'audio' }
  }
  [ordered]@{
    kind = 'audio'
    volume = [int]$volume
    muted = [bool]$muted
  }
}
`;

/**
 * The artwork half. A retryable miss (no thumbnail yet, truncated image) is
 * re-read for up to 5 polls before its negative is cached; over-cap is
 * definitive at once and a thrown load is never cached. The stream arrives as
 * a bare `__ComObject`, so the read is chunked and the format sniffed from the
 * bytes. No public `DataReader` constructor exists to bind, hence the
 * reflected `IInputStream` overload. Comments inside the script are minimal
 * because the whole string travels as one `-EncodedCommand`.
 */
const ARTWORK = `
$null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]

$ArtworkRetryLimit = 5
$artworkAttempts = @{}

function Wait-Operation($operation) {
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([string]$operation.Status -eq 'Started') {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'async operation did not finish' }
    Start-Sleep -Milliseconds 5
  }
  if ([string]$operation.Status -ne 'Completed') { throw "async operation ended: $($operation.Status)" }
  return $operation.GetResults()
}

function Test-CompleteImage($buffer, $ext) {
  if ($ext -eq 'png') {
    if ($buffer.Length -lt 8) { return $false }
    return ([Text.Encoding]::ASCII.GetString($buffer, $buffer.Length - 8, 4) -eq 'IEND') -and
      ($buffer[$buffer.Length - 4] -eq 0xae -and $buffer[$buffer.Length - 3] -eq 0x42 -and
       $buffer[$buffer.Length - 2] -eq 0x60 -and $buffer[$buffer.Length - 1] -eq 0x82)
  }
  if ($ext -eq 'jpg') {
    return ($buffer.Length -ge 2) -and ($buffer[$buffer.Length - 2] -eq 0xff) -and ($buffer[$buffer.Length - 1] -eq 0xd9)
  }
  if ($ext -eq 'webp') {
    if ($buffer.Length -lt 12) { return $false }
    return ([int64][BitConverter]::ToUInt32($buffer, 4) + 8) -eq $buffer.Length
  }
  return $false
}

function Get-ArtworkResult($session) {
  $properties = Wait-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $thumbnail = $properties.Thumbnail
  if ($null -eq $thumbnail) { return @{ status = 'retry' } }
  $stream = Wait-WinRt ($thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])

  $constructor = ${DATA_READER_CONSTRUCTOR}
  if ($null -eq $constructor) { return @{ status = 'retry' } }
  $reader = $constructor.Invoke(@($stream))
  $chunks = [System.Collections.Generic.List[byte]]::new()
  try {
    while ($true) {
      $loaded = [int](Wait-Operation ($reader.LoadAsync(65536)))
      if ($loaded -le 0) { break }
      $chunk = [byte[]]::new($loaded)
      $reader.ReadBytes($chunk)
      $chunks.AddRange($chunk)
      if ($chunks.Count -gt ${SMTC_ARTWORK_RAW_BYTES}) { return @{ status = 'over' } }
    }
  } finally {
    $reader.Dispose()
  }

  $buffer = $chunks.ToArray()
  if ($buffer.Length -lt 12) { return @{ status = 'retry' } }
  $ext = $null
  if ($buffer[0] -eq 0x89 -and $buffer[1] -eq 0x50 -and $buffer[2] -eq 0x4e -and $buffer[3] -eq 0x47) { $ext = 'png' }
  elseif ($buffer[0] -eq 0xff -and $buffer[1] -eq 0xd8 -and $buffer[2] -eq 0xff) { $ext = 'jpg' }
  elseif ([Text.Encoding]::ASCII.GetString($buffer, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($buffer, 8, 4) -eq 'WEBP') { $ext = 'webp' }
  if ($null -eq $ext) { return @{ status = 'retry' } }
  if (-not (Test-CompleteImage $buffer $ext)) { return @{ status = 'retry' } }

  $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($buffer)
  $hex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  @{ status = 'artwork'; line = [ordered]@{
    kind = 'artwork'
    sessionId = $session.SourceAppUserModelId
    sha256 = $hex
    ext = $ext
    base64 = [Convert]::ToBase64String($buffer)
  } }
}

function Try-EmitArtwork($session, $line) {
  $sessionId = $line['sessionId']
  $key = "$sessionId|$($line['title'])|$($line['artist'])|$($line['album'])"
  if ($lastArtwork.ContainsKey($sessionId) -and $lastArtwork[$sessionId] -eq $key) { return }
  try {
    $result = Get-ArtworkResult $session
  } catch {
    return
  }
  if ($result['status'] -eq 'artwork') {
    [Console]::Out.WriteLine(($result['line'] | ConvertTo-Json -Compress))
    $lastArtwork[$sessionId] = $key
    $artworkAttempts.Remove($sessionId)
    return
  }
  if ($result['status'] -eq 'over') {
    $lastArtwork[$sessionId] = $key
    $artworkAttempts.Remove($sessionId)
    return
  }
  $attempt = @{ key = $key; count = 0 }
  if ($artworkAttempts.ContainsKey($sessionId)) { $attempt = $artworkAttempts[$sessionId] }
  if ($attempt['key'] -ne $key) { $attempt = @{ key = $key; count = 0 } }
  $attempt['count'] = $attempt['count'] + 1
  $artworkAttempts[$sessionId] = $attempt
  if ($attempt['count'] -ge $ArtworkRetryLimit) {
    $lastArtwork[$sessionId] = $key
    $artworkAttempts.Remove($sessionId)
  }
}
`;

const POLL = `
$manager = $null
while ($true) {
  # Audio is read every poll and independently of any session: a machine with
  # no media session still reports its volume, and a manager failure below
  # does not stop this line.
  try {
    [Console]::Out.WriteLine((Get-AudioLine | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine('{"kind":"audio"}')
  }

  if ($null -eq $manager) {
    try {
      $manager = Wait-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    } catch {
      $manager = $null
    }
  }
  if ($null -eq $manager) {
    [Console]::Out.WriteLine('{"kind":"error"}')
    Start-Sleep -Milliseconds 1000
    continue
  }

  $sessions = $null
  try {
    $raw = $manager.GetSessions()
    if ($null -eq $raw) { throw 'GetSessions returned null' }
    # The WinRT IVectorView arrives as a bare __ComObject: member enumeration
    # reads Count over its items (empty) and the foreach below sees nothing.
    # Materialise it into a PowerShell array first.
    $sessions = @($raw | ForEach-Object { $_ })
  } catch {
    $sessions = $null
    [Console]::Out.WriteLine('{"kind":"error"}')
  }
  if ($null -ne $sessions) {
    if ($sessions.Count -eq 0) {
      [Console]::Out.WriteLine('{"kind":"none"}')
    } else {
      $currentId = $null
      try {
        $current = $manager.GetCurrentSession()
        if ($null -ne $current) { $currentId = $current.SourceAppUserModelId }
      } catch {
        $currentId = $null
      }
      # Per session, so one unreadable app does not hide the others.
      foreach ($session in $sessions) {
        try {
          $isCurrent = ($null -ne $currentId) -and ($session.SourceAppUserModelId -eq $currentId)
          $line = Get-SessionLine $session $isCurrent
          [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress))
          if ($WantArtwork) { Try-EmitArtwork $session $line }
        } catch {
          [Console]::Out.WriteLine('{"kind":"error"}')
        }
      }
    }
  }
  Start-Sleep -Milliseconds 1000
}
`;

/**
 * The artwork half before its poll loop: the WinRT awaits, the chunked read,
 * the completeness check and the dedupe. Exported so a Windows test can
 * execute that logic without needing a live thumbnail.
 */
export const SMTC_ARTWORK_FUNCTIONS: string = HEADER + ARTWORK;

/**
 * The poll script. Artwork is compiled out unless the caller asked for it;
 * the supervisor has no command channel, so the script chosen at spawn is the
 * request.
 */
export function smtcScript(options: SmtcScriptOptions = {}): string {
  const base = `${HEADER}${AUDIO}`;

  return options.artwork === true
    ? `${base}${ARTWORK}\n$WantArtwork = $true\n$lastArtwork = @{}\n${POLL}`
    : `${base}${POLL}`;
}

export const SMTC_SCRIPT: string = smtcScript();

const STATES = new Set(["playing", "paused", "stopped"]);
const EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const SHA256_HEX = /^[0-9a-f]{64}$/;

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

/** A WinRT property may be absent or null; both read as "". */
function text(value: unknown): string | undefined {
  if (value === null) return "";
  return typeof value === "string" ? value : undefined;
}

function seconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

/** One line from the helper; anything malformed is not a session. */
export function parseSmtcLine(line: string): SmtcSession | undefined {
  const record = parseObject(line);
  if (record === undefined || record["kind"] !== "session") return undefined;

  const title = text(record["title"]);
  const artist = text(record["artist"]);
  const album = text(record["album"]);
  const app = record["app"];
  const sessionId = record["sessionId"];
  const state = record["state"];
  const positionS = seconds(record["positionS"]);
  const durationS = seconds(record["durationS"]);

  if (title === undefined || artist === undefined || album === undefined) {
    return undefined;
  }
  if (typeof app !== "string" || typeof sessionId !== "string") {
    return undefined;
  }
  if (typeof state !== "string") return undefined;
  if (positionS === undefined || durationS === undefined) return undefined;

  return {
    title,
    artist,
    album,
    state: STATES.has(state) ? (state as SmtcSession["state"]) : "stopped",
    positionS,
    durationS,
    app,
    sessionId,
  };
}

/**
 * Whether the system calls this session the current one. Kept beside
 * `parseSmtcLine` rather than folded into `SmtcSession` so the session shape a
 * theme's keys see is unchanged.
 */
export function smtcSessionIsCurrent(line: string): boolean {
  const record = parseObject(line);
  return (
    record !== undefined &&
    record["kind"] === "session" &&
    record["current"] === true
  );
}

/**
 * The endpoint volume line. Both keys present is a reading; both absent is a
 * machine with no default render endpoint, which is an absence rather than
 * zero and unmuted. One key without the other is not a reading the script
 * writes, so a line carrying it is malformed.
 */
export interface SmtcAudio {
  readonly volume?: number;
  readonly muted?: boolean;
}

export function parseSmtcAudio(line: string): SmtcAudio | undefined {
  const record = parseObject(line);
  if (record === undefined || record["kind"] !== "audio") return undefined;

  const volume = record["volume"];
  const muted = record["muted"];

  if (volume === undefined && muted === undefined) return {};
  if (volume === undefined || muted === undefined) return undefined;
  if (
    typeof volume !== "number" ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 100
  ) {
    return undefined;
  }
  if (typeof muted !== "boolean") return undefined;

  return { volume, muted };
}

/**
 * `Buffer.from(x, "base64")` skips whitespace and ignores garbage, so it can
 * decode a line the helper never wrote. Only the exact encoding of the bytes
 * it produces is accepted.
 */
function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

/**
 * The artwork half of the helper's output. The digest is recomputed rather
 * than trusted: the cache is content-addressed, so a line whose name does not
 * match its bytes would poison the cache under the wrong key.
 */
export function smtcArtworkLine(line: string): ArtworkBytes | undefined {
  const record = parseObject(line);
  if (record === undefined || record["kind"] !== "artwork") return undefined;

  const sessionId = record["sessionId"];
  const sha256 = record["sha256"];
  const ext = record["ext"];
  const base64 = record["base64"];

  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return undefined;
  if (typeof ext !== "string" || !EXTENSIONS.has(ext)) return undefined;
  if (typeof base64 !== "string" || !isCanonicalBase64(base64))
    return undefined;

  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length === 0) return undefined;
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    return undefined;
  }

  return { sessionId, sha256, bytes, ext };
}
