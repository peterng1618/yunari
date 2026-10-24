# 0107 — Frame statistics come from RTSS memory, then a PresentMon shell in 6.2

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/frame/rolling.ts`,
  `src/web/packages/host/src/providers/frame/rtss.ts`,
  `src/web/packages/host/src/providers/frame/provider.ts`

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

Probe performed on this machine before implementation (not re-run during it):

- `C:\Program Files (x86)\RivaTuner Statistics Server` is installed and RTSS
  is **not running** (no process, so no live mapping and no live reading).
- `SDK\Include\RTSSSharedMemory.h` is present and was read: the app-entry
  fields and their offsets are derived from the declared layout, not guessed.
  The ring-buffer index formula is the shipped
  `OverlayDataProviderInternal.cpp`'
  `(dwPos + dwStatFrameTimeBufPos) & 1023`.
- PresentMon is not installed standalone. RTSS bundles a copy under its own
  tree; that copy is not a dependency the product may ship.

The probe establishes the layout and the absence of a live source. It does not
establish a live reading; the adapter is therefore verified against the header
and against a parser/window test double, and a live reading is reported as
unverified.

## Decision

Read the RTSS mapping from an embedded PowerShell 5.1 script under the existing
supervisor. The script emits one JSON line per newly observed frame
(`{"kind":"frame","frametimeMs":…,"app":…}`), plus an `idle` heartbeat and a
one-shot `unavailable` naming RTSS; it never launches or hooks anything. The
TypeScript `FrameWindow` owns the rolling windows, so both halves are testable
without RTSS present. Header offsets come from the SDK header and are embedded
beside the script; the mapping name and signature are checked and an absent RTSS
is a reported `unavailable`, never a zero reading. PresentMon is deferred to
Task 6.2, where its binary and licence are the subject.
