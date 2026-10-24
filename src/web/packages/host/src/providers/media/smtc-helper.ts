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

# AsTask has a non-generic IAsyncAction overload of the same arity; only the
# generic definition can be closed with MakeGenericMethod.
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

function Get-SessionLine($session) {
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
    app = $session.SourceAppUserModelId
    sessionId = $session.SourceAppUserModelId
    title = $properties.Title
    artist = $properties.Artist
    album = $properties.AlbumTitle
    state = $state
    positionS = [math]::Round($position, 3)
    durationS = [math]::Round($timeline.EndTime.TotalSeconds, 3)
    # The artwork half reads this to tell "no thumbnail" from "broken emit".
    hasArtwork = ($null -ne $properties.Thumbnail)
  }
}
`;

const ARTWORK = `
$null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]

# A retryable miss (no thumbnail yet, truncated image) is re-read for up to 5
# attempts, about 5 s at one poll a second, before its negative is cached.
# Over-cap is definitive at once; a thrown load error is never cached.
$ArtworkRetryLimit = 5
$artworkAttempts = @{}

# The stream arrives as a bare __ComObject, so PowerShell cannot read its Size,
# ContentType or call AsTask on its load operation. Load in chunks and read the
# format from the bytes instead; DataReaderLoadOperation exposes Status and
# GetResults directly, which is all the wait needs.
function Wait-Operation($operation) {
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([string]$operation.Status -eq 'Started') {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'async operation did not finish' }
    Start-Sleep -Milliseconds 5
  }
  if ([string]$operation.Status -ne 'Completed') { throw "async operation ended: $($operation.Status)" }
  return $operation.GetResults()
}

# A stream that ended early must not be published as a whole image.
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

# The outcome of one artwork read: an emitted line, a definitive over-cap
# answer, or a retryable miss. A thrown load error is the caller's to retry.
function Get-ArtworkResult($session) {
  $properties = Wait-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $thumbnail = $properties.Thumbnail
  if ($null -eq $thumbnail) { return @{ status = 'retry' } }
  $stream = Wait-WinRt ($thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])

  # No public constructor to bind: select the IInputStream overload.
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
      # Derived from the supervisor's line cap; see SMTC_ARTWORK_RAW_BYTES.
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

# Only over-cap and the exhausted retry count cache a negative for the track;
# a track that gains artwork later still gets it. One failure never reaches
# the next session in the poll.
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
try {
  $manager = Wait-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
  [Console]::Out.WriteLine('{"kind":"error"}')
  exit 0
}

while ($true) {
  $sessions = $null
  try {
    $sessions = $manager.GetSessions()
  } catch {
    [Console]::Out.WriteLine('{"kind":"error"}')
  }
  if ($null -ne $sessions) {
    if ($sessions.Count -eq 0) {
      [Console]::Out.WriteLine('{"kind":"none"}')
    } else {
      # Per session, so one unreadable app does not hide the others.
      foreach ($session in $sessions) {
        try {
          $line = Get-SessionLine $session
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
  return options.artwork === true
    ? `${SMTC_ARTWORK_FUNCTIONS}\n$WantArtwork = $true\n$lastArtwork = @{}\n${POLL}`
    : `${HEADER}${POLL}`;
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

  const sha256 = record["sha256"];
  const ext = record["ext"];
  const base64 = record["base64"];

  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return undefined;
  if (typeof ext !== "string" || !EXTENSIONS.has(ext)) return undefined;
  if (typeof base64 !== "string" || !isCanonicalBase64(base64))
    return undefined;

  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length === 0) return undefined;
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    return undefined;
  }

  return { sha256, bytes, ext };
}
