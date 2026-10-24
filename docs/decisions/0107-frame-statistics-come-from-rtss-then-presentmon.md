# 0107 — Frame statistics come from RTSS memory, then a PresentMon shell in 6.2

- **Date:** 2026-10-24
- **Status:** accepted; amended by
  [0110](0110-the-tray-may-start-rtss-on-request.md) for the tray's explicit
  Start action. All other findings stand.
- **Paths:** `src/web/packages/host/src/providers/frame/rolling.ts`,
  `src/web/packages/host/src/providers/frame/rtss.ts`,
  `src/web/packages/host/src/providers/frame/presentmon.ts`,
  `src/web/packages/host/src/providers/frame/provider.ts`,
  `src/web/packages/host/scripts/vendor-presentmon.mjs`

## The problem

The host must publish `fps.current`, `frametime.current`, `fps.low1` and
`frame.app` for whichever 3D application is running. Reading another process's
presented frames is a mechanism boundary: the wrong choice fails silently by
showing a plausible but wrong number, or by launching an overlay that hooks
games. The shape is not "get an FPS number" — it needs a per-frame source, a
rolling 60-second window that this process owns, a lifecycle tied to whether a
display binds `frame.*`, and a truthful `unavailable` when no source is running.

## Rung 1 — Yunari

Searched: `rg -n -i "rtss|presentmon|frametime|frame time|fps\.current"` across
the repo (excluding `dist`, `node_modules`, generated icon files); the provider
tree `src/web/packages/host/src/providers/`; `semantic-keys.ts`'s `frame`
family.

Found: the four vocabulary entries already exist with labels, units and
`expectedTier: "extended"`; `descriptorFieldsOf` is the shared descriptor
forwarder. The supervisor (`startJsonLineHelper`, §0102) already owns embedded
PowerShell scripts, line framing, restart backoff and tree kill — the frame
helper is its fourth client. No frame reader, window or adapter exists. The host
has no dependency that reads another process's frames.

## Rung 2 — dependencies

Searched: `packages/host/package.json` dependencies; `npm ls` tree for any
frame/ETW/FFI package; `npm view` on the PresentMon-adjacent hits.

Found: runtime deps are `ffmpeg-static`, `node-forge`,
`systeminformation`, plus workspace packages. No FFI (`koffi`/`ffi-napi`), no
ETW binding, no shared-memory package, no PresentMon package. Adding one would
need a licence and `THIRD-PARTY-NOTICES.md` entry, and none of the candidates
below covers the whole shape anyway.

## Rung 3 — platform

Searched: the installed RTSS SDK (`C:\Program Files (x86)\RivaTuner Statistics
Server\SDK`): `Include\RTSSSharedMemory.h`, the two sample apps under
`SDK\Samples`, and the shipped `SDK\Plugins\Client\OverlayEditor` reader;
the header's struct offsets were computed from the declared field order.

Found: RTSS publishes a file mapping named `RTSSSharedMemoryV2`. The header
prefix carries `dwSignature` (`'RTSS'`), `dwVersion`, and the version-independent
read pointers `dwAppEntrySize`, `dwAppArrOffset`, `dwAppArrSize`. Each
`RTSS_SHARED_MEMORY_APP_ENTRY` carries `dwProcessID`, `szName[MAX_PATH]`,
instantaneous `dwTime0/dwTime1/dwFrames/dwFrameTime`, aggregate
`dwStatFramerateMin/Avg/Max`, and — the reason this adapter can satisfy
`fps.low1` — a 1024-entry ring `dwStatFrameTimeBuf` with
`dwStatFrameTimeBufPos` and `dwStatFrameTimeBufFramerate`
(`OverlayDataProviderInternal.cpp` reads it as
`buf[(i + pos) & 1023]`, newest at `(pos - 1) & 1023`, microseconds).

What the platform leaves to us: RTSS only runs when the user runs it; it hooks
games itself (we must not start it or inject anything); there is no event, so we
poll; the mapping can vanish when RTSS exits; uninitialised ring slots read as
zero; and selecting "the active app" has no single documented rule beyond the
v2.16 `dwLastForegroundAppProcessID` hint. The OS gives `OpenFileMapping` /
`MapViewOfFile` (or .NET `MemoryMappedFile`), no parsing.

## Rung 4 — ecosystem

Searched (npm, live):
- `npm search rtss` → only unrelated hits (`@stablelib/tss`,
  `@ohif/extension-cornerstone-dicom-rt`, `rtjs-base`, Garmin analytics).
  No RTSS reader.
- `npm search presentmon` → `@qaping/rig` (test harness that invokes the
  PresentMon binary), `@antonsoloviev/stutterscope` (offline capture analysis),
  `pmonp` ("Present<on parser for Node.js"). Inspected `pmonp`: it parses
  PresentMon CSV (`csvtojson`, `formulajs`), so it consumes a capture another
  process produced — it does not capture, map memory, or own a live window.
- `npm search frametime` → `frametime` (browser
  `requestAnimationFrame` meter), `@zakkster/lite-raf`, video/GPU packages.
  None reads another process on Windows.
- `npm search fps-counter` → browser/rAF and React meters only.
- `npm search riva-tuner` → unrelated (Mirakurun, NVIDIA NIM, tuners).

Searched GitHub (`api.github.com/search/repositories`):
- `RTSS shared memory` → `spencerhakim/RTSSSharedMemoryNET` (LGPL-3.0, C++
  labelled .NET, README is a stub, no exposed API), `mkullber/HWiNFO-RTSS`
  (Python, no licence), `mbarrben/rtss-shared-memory-reader` (JavaScript, MIT,
  1 star), `sciner/rtss-reader` (C#, MIT), plus overlay experiments.
- `presentmon node` → zero repositories.

The closest prior art, `mbarrben/rtss-shared-memory-reader`, uses `koffi` FFI to
`OpenFileMappingA`/`MapViewOfFile`, computes FPS from `dwFrames * 1000 /
(dwTime1 - dwTime0)`, and serves JSON from Express. It solves *opening the map*;
it does not use `dwStatFrameTimeBuf`, so it has no per-frame history to build a
1% low from, it does not own a rolling window or a demand-driven lifecycle, and
it pulls in an FFI dependency plus an HTTP server we do not need. The C#/Python
readers are the same shape in other runtimes.

PresentMon is the other family: Intel's ETW consumer watches D3D present events
without a vendor overlay, but it is a separate executable (RTSS itself bundles a
copy, which is not a shippable dependency), and Node has no maintained ETW
binding. That work is Task 6.2's adapter, not this one.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| RTSS shared memory via embedded PowerShell + .NET `MemoryMappedFile` | Exact per-frame ring already maintained; supervisor and UTF-8 line contract exist; no new dependency | ~150 lines of script and parser; poll at 100 ms | RTSS must be installed and running; layout is version-sensitive, so read header offsets and fail closed | Chosen |
| `koffi` FFI to `OpenFileMapping` | Same data, native speed | New runtime dependency + licence + notices; native ABI per Node version | FFI packaging on Windows, and it still needs the same window/lifecycle code | Rejected |
| `pmonp` / PresentMon CSV parser | PresentMon's ETW is vendor-neutral and better on present timing | Needs a capturing PresentMon process first; `pmonp` parses files, not a live pipe; PresentMon binary licensing/distribution undecided | A dependency that does not acquire anything the host needs; deferred to 6.2 by the plan | Rejected for 6.1 |
| Launch/ship RTSS or use its bundled PresentMon | Would remove the "not running" state | Third-party binary distribution, licence, overlay side effects | Starts an overlay that hooks games; controller forbade launching it; not shippable | Rejected |
| Compute from a browser rAF meter | No external process | It measures the browser, not the game | Wrong data by construction | Rejected |

## Rung 6 — probe

Probe performed on this machine before and during implementation:

- `C:\Program Files (x86)\RivaTuner Statistics Server` is installed and RTSS
  is **not running** (no process, so no live mapping and no live reading).
- `SDK\Include\RTSSSharedMemory.h` is present and was read. The ring-buffer
  index formula is the shipped `OverlayDataProviderInternal.cpp`'
  `(dwPos + dwStatFrameTimeBufPos) & 1023`.
- **Compiler offset probe** (`Add-Type` + `Marshal.OffsetOf` on
  `LayoutKind.Sequential` structs mirroring the declared fields):

  | Field | Offset |
  |---|---|
  | `Header.dwVersion` | 4 |
  | `Header.dwAppEntrySize` | 8 |
  | `Header.dwAppArrOffset` | 12 |
  | `Header.dwAppArrSize` | 16 |
  | `Header.dwLastForegroundAppProcessID` | 68 |
  | `AppEntry.dwProcessID` | 0 |
  | `AppEntry.szName` | 4 |
  | `AppEntry.dwTime1` | 272 |
  | `AppEntry.dwStatFrameTimeBuf` | 924 |
  | `AppEntry.dwStatFrameTimeBufPos` | **5020** |
  | `AppEntry.dwStatFrameTimeBufFramerate` | **5024** |
  | `Header` size / `AppEntry` size | 72 / 5028 |

  A hand-summed table read 5024 as `dwStatFrameTimeBufPos`, which is actually
  `dwStatFrameTimeBufFramerate`; every live reading would have been wrong. The
  implementation now declares the structs and reads fields by name through
  `Marshal.PtrToStructure`, so no summed offset remains to be wrong.
- **Synthetic-mapping A/B** (no RTSS running, a named mapping built from the
  header above and one `game.exe` entry whose ring advances at 100 fps): the
  hand-summed `5024` script emitted **0** frame lines; the identical script
  with only `5024 → 5020` emitted **137** `frame` lines, all
  `{"frametimeMs":6.944,"app":"game.exe"}`. The same harness now feeds the
  Windows layout/traversal test in `rtss.windows.test.ts`.
- PresentMon is not installed standalone. RTSS bundles a copy under its own
  tree; that copy is not a dependency the product may ship.

The probe establishes the layout through a compiler rather than a reading of
the header prose, and establishes the absence of a live source. It does not
establish a live reading; a live RTSS run is reported as unverified.

## Decision

Read the RTSS mapping from an embedded PowerShell 5.1 script under the existing
supervisor. The script emits one JSON line per newly observed frame
(`{"kind":"frame","frametimeMs":…,"app":…}`), plus an `idle` heartbeat and a
one-shot `unavailable` naming RTSS; it never launches or hooks anything. The
TypeScript `FrameWindow` owns the rolling windows, so both halves are testable
without RTSS present. The app and header structs are declared with
`LayoutKind.Sequential` and read through the runtime marshaler; a golden-table
test pins the marshaler's offsets, and a synthetic entry array proves selection
and ring traversal without RTSS. The mapping name and signature are checked and
an absent RTSS is a reported `unavailable`, never a zero reading. PresentMon is
deferred to Task 6.2, where its binary and licence are the subject.

## Amendment (0110)

The tray may start RTSS when the owner clicks its Start row. It still never
auto-starts, injects into a process or hooks a game, and it never stops RTSS.
The reading and reporting decisions above are unchanged; starting RTSS only
removes the absence the adapter already reports.

## PresentMon extension (Task 6.2)

The RTSS half above left PresentMon deferred. Its mechanism genuinely differs
— a separate console executable emitting CSV, not a PowerShell script reading
a file mapping — so the rungs were worked again for that shape.

- **Rung 1 — Yunari.** `rg -n "presentmon|restart_as_admin|killTree"` across
  `src/web/packages/host`: only the deferral notes and the supervisor's
  `killProcessTree` exist. The `FrameAdapter` contract (`start` returns a stop
  handle) and `FrameProvider`'s demand window are reusable; no frame reader
  for a child process exists.
- **Rung 2 — dependencies.** `packages/host/package.json` still has no FFI, ETW
  or CSV dependency. `npm search presentmon` (recorded under rung 4 above)
  found only file parsers and harnesses; none acquires frames.
- **Rung 3 — platform.** PresentMon's console app takes `--output_stdout`
  (`WriteCsvHeader`/`WriteCsvRow` flush per row) and `--no_csv` (no file), and
  `--session_name` names the ETW session. It does **not** need a wrapper: it
  already writes line-delimited CSV. The OS provides `spawn` and `taskkill`;
  Node has no ETW binding.
- **Rung 4 — ecosystem.** The closest package, `pmonp`, parses a CSV a capture
  already produced; it neither spawns nor filters a live session. `@qaping/rig`
  is a test harness around the binary, not a live adapter. No npm package owns
  sampling, ordering, disposal or the demand window.
- **Rung 5 — comparison.** (a) Spawn the console exe directly and frame its
  stdout: no dependency, one process, the supervisor's tree kill, and the
  adapter owns only line framing and header lookup. (b) A PowerShell wrapper
  around the exe: an extra interpreter and no gain. (c) An FFI ETW binding:
  new native dependency, licence and ABI surface for the same events.
  (d) `pmonp`: cannot acquire. Chosen: (a).
- **Rung 6 — probe.** Read `PresentMon/CsvOutput.cpp` at `v2.6.0`: the v1
  header spells `msBetweenPresents` lowercase while the v2 header spells
  `MsBetweenPresents`, so column lookup is case-insensitive and by name, never
  by position. `MainThread.cpp` proves a denied session prints
  `failed to start trace session: access denied.` plus the `Performance Log
  Users` requirement, and that `--restart_as_admin` defaults off (so omitting
  it never prompts) while `--stop_existing_session` must stay off (it would
  kill the user's session). The release asset
  `PresentMon-2.6.0-x64.exe` (980 320 bytes) hashes to
  `b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af`; licence
  from GitHub's licence API is MIT (`LICENSE.txt`). No live trace session was
  run: PresentMon is not installed standalone on this machine, so a successful
  capture is unverified.
- **Rung 7 — build.** Spawn the vendored executable with `--output_stdout
  --no_csv --session_name Yunari`, parse stdout by header name, and end the
  process with `killProcessTree` (not `.kill()`, which leaves a grandchild).
  The binary is staged by `vendor-presentmon.mjs`, never committed. The
  provider evaluates adapters in order, starts PresentMon only after RTSS
  reports unavailable, and does not retry an exhausted pair until the demand
  window closes.
- **Silent capture.** PresentMon writes its CSV header only with the first
  frame, so no output while a display waits for a game is healthy and the
  adapter sets no liveness timeout. Process exit is the only failure signal; a
  capture that wedges without exiting is not killed until the demand window
  closes. The controller accepted that residual risk because the alternative —
  a 15 s timeout — killed the common open-theme-then-launch-game flow.

The vendor script follows `vendor-lhm.mjs`'s existing shape rather than
inventing a downloader: pinned release URL, pinned SHA-256 that refuses a
mismatch, a `PROVENANCE.txt`, and the licence file staged beside the binary.
Binaries stay out of git (`vendor/` is ignored); the repository tracks
provenance.
