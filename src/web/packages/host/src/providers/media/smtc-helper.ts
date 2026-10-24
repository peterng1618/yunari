import { createHash } from "node:crypto";

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
  }
}
`;

const ARTWORK = `
$null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]

# The stream arrives as a bare __ComObject, so PowerShell cannot read its Size,
# ContentType or call AsTask on its load operation. Load in chunks and read the
# format from the bytes instead; DataReaderLoadOperation exposes Status and
# GetResults directly, which is all the wait needs.
function Wait-Operation($operation) {
  while ([string]$operation.Status -eq 'Started') { Start-Sleep -Milliseconds 5 }
  if ([string]$operation.Status -ne 'Completed') { throw "async operation ended: $($operation.Status)" }
  return $operation.GetResults()
}

function Get-ArtworkLine($session) {
  $properties = Wait-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $thumbnail = $properties.Thumbnail
  if ($null -eq $thumbnail) { return $null }
  $stream = Wait-WinRt ($thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])

  # No public constructor to bind: select the IInputStream overload.
  $constructor = ${DATA_READER_CONSTRUCTOR}
  if ($null -eq $constructor) { return $null }
  $reader = $constructor.Invoke(@($stream))
  $chunks = [System.Collections.Generic.List[byte]]::new()
  try {
    while ($true) {
      $loaded = [int](Wait-Operation ($reader.LoadAsync(65536)))
      if ($loaded -le 0) { break }
      $chunk = [byte[]]::new($loaded)
      $reader.ReadBytes($chunk)
      $chunks.AddRange($chunk)
      # The supervisor drops any line over 1 MiB, and base64 costs 4/3: a
      # bigger thumbnail is not deliverable anyway.
      if ($chunks.Count -gt 786432) { return $null }
    }
  } finally {
    $reader.Dispose()
  }

  $buffer = $chunks.ToArray()
  if ($buffer.Length -lt 12) { return $null }
  $ext = $null
  if ($buffer[0] -eq 0x89 -and $buffer[1] -eq 0x50 -and $buffer[2] -eq 0x4e -and $buffer[3] -eq 0x47) { $ext = 'png' }
  elseif ($buffer[0] -eq 0xff -and $buffer[1] -eq 0xd8 -and $buffer[2] -eq 0xff) { $ext = 'jpg' }
  elseif ([Text.Encoding]::ASCII.GetString($buffer, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($buffer, 8, 4) -eq 'WEBP') { $ext = 'webp' }
  if ($null -eq $ext) { return $null }

  $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($buffer)
  $hex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  [ordered]@{
    kind = 'artwork'
    sessionId = $session.SourceAppUserModelId
    sha256 = $hex
    ext = $ext
    base64 = [Convert]::ToBase64String($buffer)
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
  try {
    $sessions = $manager.GetSessions()
    if ($null -eq $sessions -or $sessions.Count -eq 0) {
      [Console]::Out.WriteLine('{"kind":"none"}')
    } else {
      foreach ($session in $sessions) {
        $line = Get-SessionLine $session
        [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress))
        if ($WantArtwork) {
          $key = "$($line['sessionId'])|$($line['title'])|$($line['artist'])|$($line['album'])"
          if (-not $lastArtwork.ContainsKey($line['sessionId']) -or $lastArtwork[$line['sessionId']] -ne $key) {
            $lastArtwork[$line['sessionId']] = $key
            $artwork = Get-ArtworkLine $session
            if ($null -ne $artwork) { [Console]::Out.WriteLine(($artwork | ConvertTo-Json -Compress)) }
          }
        }
      }
    }
  } catch {
    [Console]::Out.WriteLine('{"kind":"error"}')
  }
  Start-Sleep -Milliseconds 1000
}
`;

/**
 * The poll script. Artwork is compiled out unless the caller asked for it;
 * the supervisor has no command channel, so the script chosen at spawn is the
 * request.
 */
export function smtcScript(options: SmtcScriptOptions = {}): string {
  const artwork = options.artwork === true;
  return (
    HEADER +
    (artwork ? `${ARTWORK}\n$WantArtwork = $true\n$lastArtwork = @{}\n` : "") +
    POLL
  );
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
  if (typeof base64 !== "string" || base64 === "") return undefined;

  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length === 0) return undefined;
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    return undefined;
  }

  return { sha256, bytes, ext };
}
