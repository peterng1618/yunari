# TURZX 5" Serial Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the TURZX/Turing 5" serial panel as a Yunari display, record the hardware/firmware it was verified against, expose its safe hardware controls, and play a theme's video background on it with a UI overlay.

**Architecture:** A `serialport`-backed transport behind an injectable seam feeds a TURZX adapter that implements the existing `PanelDevice` port. The family table splits into per-driver modules, the port gains optional `controls` and `video` capabilities, and the runner grows an in-flight guard. Video mode captures a transparent UI-only PNG and sends diff updates to the panel's overlay layer.

**Tech Stack:** TypeScript, Node 22+, Vitest, `serialport` 13 (MIT), `ffmpeg-static` (already shipped), headless Chromium CDP, Base UI Dialog, React 19.

**Spec:** `docs/superpowers/specs/2026-10-29-turzx-serial-panel-design.md`

**Phase map:** Plan Phases 1–2 implement the spec's Phase 1 (static panel, registry, controls). Plan Phase 3 implements the spec's Phase 2 (video overlay). One plan, three plan phases of four tasks.

**Execution prerequisite:** `STATUS.md` names this plan as the active plan before Task 1 starts, and no other incomplete plan is active.

## Global Constraints

- Panel geometry is **800×480 landscape, no rotation**.
- Serial framing: 115200 8N1, RTS/CTS. **Every write is padded to a 250-byte multiple**: `0x00` normally, `0x2c` for `START_DISPLAY_BITMAP`.
- HELLO replies `chs_5inch.dev1_rom1.88`; model `chs_5inch`, firmware `1.88`.
- `supportedFirmware` is `["1.88"]` for the TURZX row until another value is verified.
- Controls are TURZX-only in this plan; Lian Li and Kraken rows declare no controls.
- Never expose firmware-update commands, `PRE_UPDATE` as a firmware step, or raw command entry.
- Refuse invalid numeric input; never coerce a level outside 0–100 or a non-integer to a byte.
- One new direct dependency only: `serialport` (MIT). Add its notices and dependency rows in the same task.
- Exercise `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` honestly: omit optional fields rather than writing `undefined`.
- Record the full gate's command and exit code at each phase boundary; a piped gate hides the code.

## Review Focus

- A serial port another program holds (the TURZX vendor app) must yield a named error and no crash — Task 3.
- A serial port with no usable USB ids (COM1) must be skipped, not offered as an unaddable panel — Task 3.
- A HELLO reply that is not `chs_…rom…` must leave the device unclaimed, not misidentified — Task 3.
- An out-of-range or fractional brightness level must be refused with 400, never coerced — Tasks 6 and 7.
- A theme video that is not 800×480, has audio, or fails to transcode must fall back to static frames with one reported error — Task 9's transcode test and Task 12's hardware verification.

---

## Plan Phase 1 — Serial foundation and static panel

### Task 1: TURZX wire codec and the serialport dependency

**Files:**
- Create: `src/web/packages/host/src/panels/turzx-protocol.ts`
- Test: `src/web/packages/host/src/panels/turzx-protocol.test.ts`
- Modify: `src/web/packages/host/package.json` (via `npm install`)
- Modify: `THIRD-PARTY-NOTICES.md`, `docs/engineering/dependencies.md`

**Interfaces:**
- Produces:
```ts
export const TURZX_GEOMETRY: { readonly width: 800; readonly height: 480 };
export interface TurzxIdentity {
  readonly model: string;
  readonly device: string;
  readonly firmware: string;
}
export function frame(bytes: Uint8Array, padding?: "null" | "bitmap"): Uint8Array;
export function parseHello(reply: Uint8Array): TurzxIdentity | undefined;
export function bgraPayload(rgba: Uint8Array): Uint8Array;
export const TURZX_COMMAND: {
  readonly hello: Uint8Array;
  readonly stopVideo: Uint8Array;
  readonly stopMedia: Uint8Array;
  readonly brightness: Uint8Array;   // prefix; caller appends the level byte
  readonly screenOff: Uint8Array;
  readonly screenOn: Uint8Array;
  readonly restart: Uint8Array;
  readonly preUpdate: Uint8Array;
  readonly startBitmap: Uint8Array;
  readonly displayBitmap: Uint8Array;
  readonly displayOnVideo: Uint8Array;
  readonly queryStatus: Uint8Array;
  readonly startVideo: Uint8Array;
  readonly uploadFile: Uint8Array;
  readonly getFileSize: Uint8Array;
  readonly deleteFile: Uint8Array;
};
```
- Consumes: nothing.

- [ ] **Step 0: Claim the mechanism boundary before the first source write**

Create `docs/decisions/0133-serial-panel-and-video-overlay.md` from `docs/decisions/README.md`'s template: the seven reuse rungs (owner, dependencies, platform, ecosystem, comparison, probe, build), the probed wire facts that justify a hand-written codec, and the rejected alternatives (full-overlay re-send, diff without a visible list, directory auto-discovery). Commit it first — the reuse-gate hook refuses source writes until a note claims the path.

- [ ] **Step 1: Install the merged branch's dependencies, then add serialport**

Run from `src/web/`:
```bash
npm install
npm install serialport -w @yunari/host
```
Expected: `serialport` appears in `packages/host/package.json` dependencies; the lockfile updates; exit 0.

- [ ] **Step 2: Record the dependency**

Add to `THIRD-PARTY-NOTICES.md`'s runtime row set:
`| \`serialport\` | <lockfile version> | MIT | host: TURZX 5" panel serial transport |`

Add the same package to `docs/engineering/dependencies.md`'s Declared dependencies table with role `host: serial transport for the TURZX 5" panel`.

- [ ] **Step 3: Write the failing tests**

In `turzx-protocol.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  bgraPayload,
  frame,
  parseHello,
  TURZX_COMMAND,
  TURZX_GEOMETRY,
} from "./turzx-protocol.js";

describe("frame", () => {
  it("pads HELLO to exactly 250 bytes with the verified prefix", () => {
    const bytes = frame(TURZX_COMMAND.hello);
    expect(bytes.length).toBe(250);
    expect([...bytes.slice(0, 12)]).toEqual([
      0x01, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0xc5, 0xd3,
    ]);
    expect([...bytes.slice(12)].every((byte) => byte === 0)).toBe(true);
  });

  it("pads the bitmap start with 0x2c", () => {
    const bytes = frame(TURZX_COMMAND.startBitmap, "bitmap");
    expect(bytes.length).toBe(250);
    expect([...bytes].every((byte) => byte === 0x2c)).toBe(true);
  });
});

describe("parseHello", () => {
  it("reads the model, device and firmware", () => {
    expect(parseHello(new TextEncoder().encode("chs_5inch.dev1_rom1.88\0"))).toEqual({
      model: "chs_5inch",
      device: "dev1",
      firmware: "1.88",
    });
  });

  it("refuses a reply that is not a panel identity", () => {
    expect(parseHello(new TextEncoder().encode("play_video_success"))).toBeUndefined();
    expect(parseHello(new Uint8Array())).toBeUndefined();
  });
});

describe("bgraPayload", () => {
  it("swaps red and blue, joins 249-byte chunks with 0x00, and pads", () => {
    // Two pixels: pure red then pure blue, RGBA.
    const rgba = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
    const payload = bgraPayload(rgba);
    expect(payload.length % 250).toBe(0);
    expect([...payload.slice(0, 8)]).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
  });

  it("states the panel geometry", () => {
    expect(TURZX_GEOMETRY).toEqual({ width: 800, height: 480 });
  });
});
```

- [ ] **Step 4: Run the tests and see them fail**

Run from `src/web/`:
```bash
npx vitest run packages/host/src/panels/turzx-protocol.test.ts
```
Expected: FAIL — the module does not exist.

- [ ] **Step 5: Implement the codec**

`frame` copies the bytes into `Math.ceil(length / 250) * 250` zero bytes, or `0x2c` bytes when the padding is `"bitmap"`.
`parseHello` decodes latin1, strips trailing nulls and whitespace, and matches `/^chs_([a-z0-9_]+)\.(dev\d+)_rom([0-9.]+)$/`.
`bgraPayload` copies each RGBA pixel as BGRA, joins 249-byte chunks with one `0x00`, then pads to a 250 multiple.
`TURZX_COMMAND` carries the byte arrays from the spec's verified command table; `startBitmap` is `new Uint8Array(250).fill(0x2c)`.

- [ ] **Step 6: Run the tests and make them pass**

Run:
```bash
npx vitest run packages/host/src/panels/turzx-protocol.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/0133-serial-panel-and-video-overlay.md \
  src/web/packages/host/package.json src/web/package-lock.json \
  src/web/packages/host/src/panels/turzx-protocol.ts \
  src/web/packages/host/src/panels/turzx-protocol.test.ts \
  THIRD-PARTY-NOTICES.md docs/engineering/dependencies.md
git commit -m "feat(panels): add the TURZX serial wire codec"
```

### Task 2: Modular family rows and the extended port

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-device.ts`
- Modify: `src/web/packages/host/src/panels/tur-usb-panel.ts`
- Modify: `src/web/packages/host/src/panels/kraken-z3-panel.ts`
- Modify: `src/web/packages/host/src/panels/panel-families.ts`
- Test: `src/web/packages/host/src/panels/panel-families.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PanelSupport {
  readonly maker: string;
  readonly hardwareRevision: string;
  readonly supportedFirmware: readonly string[];
  readonly updatedAt: string; // ISO date, YYYY-MM-DD
}
export type PanelCommand =
  | { readonly kind: "brightness"; readonly level: number }
  | { readonly kind: "screen"; readonly on: boolean }
  | { readonly kind: "restart" }
  | { readonly kind: "status" }
  | { readonly kind: "hello" };
export interface PanelControls {
  readonly commands: readonly PanelCommand["kind"][];
  run(command: PanelCommand): Promise<string>;
}
export interface PanelVideo {
  start(mp4: Uint8Array): Promise<void>;
  presentOverlay(png: Uint8Array): Promise<void>;
  stop(): Promise<void>;
}
export interface PanelFamily {
  readonly id: string;
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly stores: boolean;
  readonly support: PanelSupport;
  readonly commands: readonly PanelCommand["kind"][];
  readonly attached: () => Promise<readonly PanelHint[]>;
  readonly open: () => Promise<PanelDevice>;
}
```
- `PanelDevice` gains `readonly controls?: PanelControls;` and `readonly video?: PanelVideo;`.
- `PanelHint` gains `readonly model?: string;` and `readonly firmware?: string;`.
- `tur-usb-panel.ts` exports `TUR_FAMILIES: readonly PanelFamily[]`; `kraken-z3-panel.ts` exports `KRAKEN_FAMILIES`; `panel-families.ts` exports `[...TUR_FAMILIES, ...KRAKEN_FAMILIES]` plus the existing lookups.
- Consumes: `PanelCommand` names used by Tasks 6, 7 and 9.

- [ ] **Step 1: Write the failing registry tests**

Replace `panel-families.test.ts`'s id assertions with:
```ts
it("carries a support record for every family", () => {
  for (const family of PANEL_FAMILIES) {
    expect(family.support.maker.length).toBeGreaterThan(0);
    expect(family.support.hardwareRevision.length).toBeGreaterThan(0);
    expect(family.support.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(family.support.supportedFirmware)).toBe(true);
  }
});

it("declares no controls for the rows that have none", () => {
  expect(familyFor(0x1cbe, 0xa092)?.commands).toEqual([]);
  expect(familyFor(0x1cbe, 0xa088)?.commands).toEqual([]);
  expect(familyFor(0x1e71, 0x3008)?.commands).toEqual([]);
});
```
Keep the existing uniqueness, open/attached and manager-boundary cases.

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/panels/panel-families.test.ts
```
Expected: FAIL — `support` and `commands` are absent.

- [ ] **Step 3: Move the type and the rows**

- Move `PanelFamily` from `panel-families.ts` into `panel-device.ts` and add `support`, `commands`, `PanelSupport`, `PanelCommand`, `PanelControls` and `PanelVideo`.
- Move the two Lian Li rows into `tur-usb-panel.ts` as `TUR_FAMILIES`, and the Kraken row into `kraken-z3-panel.ts` as `KRAKEN_FAMILIES`.
- Support values for the existing rows: maker `Lian Li`/`NZXT`, the product revision already in the label, `supportedFirmware: []`, and `updatedAt` taken from `git log -1 --format=%cs -- <that driver file>`.
- Do not add the TURZX row here; Task 3 adds it with its adapter.
- `panel-families.ts` imports and spreads the two arrays; `familyFor` and `attachedDevices` stay.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/panels/panel-families.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels/panel-device.ts \
  src/web/packages/host/src/panels/tur-usb-panel.ts \
  src/web/packages/host/src/panels/kraken-z3-panel.ts \
  src/web/packages/host/src/panels/panel-families.ts \
  src/web/packages/host/src/panels/panel-families.test.ts
git commit -m "refactor(panels): let each driver own its family row"
```

### Task 3: Serial transport and the TURZX adapter

**Files:**
- Create: `src/web/packages/host/src/panels/serial-transport.ts`
- Create: `src/web/packages/host/src/panels/turzx-panel.ts`
- Test: `src/web/packages/host/src/panels/turzx-panel.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SerialPortInfo {
  readonly path: string;
  readonly vendorId?: number;
  readonly productId?: number;
  readonly serialNumber?: string;
}
export interface SerialTransport {
  write(bytes: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
}
export function listSerialPorts(): Promise<readonly SerialPortInfo[]>;
export function openSerialPort(path: string): Promise<SerialTransport>;

export interface TurzxOptions {
  readonly ports?: () => Promise<readonly SerialPortInfo[]>;
  readonly open?: (path: string) => Promise<SerialTransport>;
  readonly decode?: (bytes: Uint8Array, width: number, height: number) => Promise<RawFrame>;
  readonly sleep?: (ms: number) => Promise<void>;
}
export const TURZX_FAMILIES: readonly PanelFamily[];
export async function attachedTurzxPanels(options?: TurzxOptions): Promise<readonly PanelHint[]>;
export async function openTurzxPanel(options?: TurzxOptions): Promise<PanelDevice>;
```
- Consumes: Task 1's `frame`, `parseHello`, `bgraPayload`, `TURZX_COMMAND`, `TURZX_GEOMETRY`; Task 2's `PanelFamily`, `PanelHint`, `PanelDevice`.
- `TurzxOptions.decode` defaults to `decodeStill` from `panel-image.ts`; it receives the JPEG and the geometry.

- [ ] **Step 1: Write the failing adapter tests**

Use a fake transport:
```ts
function fakeTransport(...replies: string[]) {
  const writes: Uint8Array[] = [];
  let next = 0;
  return {
    writes,
    transport: {
      write: async (bytes: Uint8Array) => { writes.push(Uint8Array.from(bytes)); },
      read: async () =>
        next < replies.length
          ? new TextEncoder().encode(`${replies[next++]}\0`)
          : new Uint8Array(),
      close: async () => {},
    } satisfies SerialTransport,
  };
}
```
Cases:
```ts
it("claims a panel only when HELLO names one", async () => {
  const ours = fakeTransport("chs_5inch.dev1_rom1.88");
  const other = fakeTransport("play_video_success");
  const hints = await attachedTurzxPanels({
    ports: async () => [
      { path: "COM5", vendorId: 0x1d6b, productId: 0x0106, serialNumber: "S1" },
      { path: "COM6", vendorId: 0x1d6b, productId: 0x0106, serialNumber: "S2" },
    ],
    open: async (path) => (path === "COM5" ? ours.transport : other.transport),
    sleep: async () => {},
  });
  expect(hints).toEqual([
    { vendorId: 0x1d6b, productId: 0x0106, serial: "S1", label: 'TURZX 5" Panel', model: "chs_5inch", firmware: "1.88" },
  ]);
});

it("skips a port with no usable USB ids and a port another program holds", async () => {
  const hints = await attachedTurzxPanels({
    ports: async () => [
      { path: "COM1" },
      { path: "COM5", vendorId: 0x1d6b, productId: 0x0106, serialNumber: "S1" },
    ],
    open: async () => { throw new Error("Access denied"); },
    sleep: async () => {},
  });
  expect(hints).toEqual([]);
});

it("opens with HELLO, stops video and media, then presents a full frame", async () => {
  const { writes, transport } = fakeTransport("chs_5inch.dev1_rom1.88");
  const panel = await openTurzxPanel({
    ports: async () => [{ path: "COM5", vendorId: 0x1d6b, productId: 0x0106 }],
    open: async () => transport,
    decode: async (_bytes, width, height) => ({
      width, height, rgba: new Uint8Array(width * height * 4).fill(255),
    }),
    sleep: async () => {},
  });

  await panel.present(Uint8Array.of(1, 2, 3));

  const helios = writes.filter((bytes) => bytes[0] === 0x01 && bytes[1] === 0xef);
  expect(helios.length).toBeGreaterThanOrEqual(1);
  expect(writes.every((bytes) => bytes.length % 250 === 0)).toBe(true);
  expect([...writes[writes.length - 4]!.slice(0, 7)]).toEqual([0x86, 0xef, 0x69, 0, 0, 0, 1]);
  expect([...writes[writes.length - 3]!.slice(0, 1)]).toEqual([0x2c]);
  expect([...writes[writes.length - 2]!.slice(0, 6)]).toEqual([0xc8, 0xef, 0x69, 0, 0x17, 0x70]);
  expect(writes[writes.length - 1]!.length % 250).toBe(0);
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/panels/turzx-panel.test.ts
```
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement the transport and adapter**

`serial-transport.ts`:
- `listSerialPorts` maps `SerialPort.list()` items, parsing `vendorId`/`productId` hex strings into numbers and dropping unusable ones.
- `openSerialPort` constructs `new SerialPort({ path, baudRate: 115_200, rtscts: true, autoOpen: false })`, opens it, and resolves writes after `drain`. `read(timeoutMs)` collects `data` events until the timeout and returns what arrived; it resolves empty on timeout rather than rejecting.

`turzx-panel.ts`:
- `attachedTurzxPanels` probes every port: skip one with no usable ids, open it, write HELLO, read for 500 ms, parse, close; keep the ones that parse.
- `openTurzxPanel` opens the first port whose HELLO parses, sends STOP_VIDEO, STOP_MEDIA and QUERY_STATUS, and returns a device whose `open()` is already done. A missing panel is refused with a sentence naming the cable, and a held port with a sentence naming the vendor app.
- `present(jpeg)` decodes, converts with `bgraPayload`, and writes PRE_UPDATE, START_BITMAP, DISPLAY_BITMAP_5INCH, then the payload, all through one serialized queue. Do not append QUERY_STATUS: a query between updates stopped rendering during probing.
- The queue is a promise chain so a frame and a control command can never interleave.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/panels/turzx-panel.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Register the family**

Add the TURZX row in `turzx-panel.ts`:
```ts
export const TURZX_FAMILIES: readonly PanelFamily[] = [
  {
    id: "turzx-5",
    label: 'TURZX 5" Panel',
    vendorId: 0x1d6b,
    productId: 0x0106,
    stores: false,
    commands: ["brightness", "screen", "restart", "status", "hello"],
    support: {
      maker: "TURZX",
      hardwareRevision: "Rev C",
      supportedFirmware: ["1.88"],
      updatedAt: "2026-10-29",
    },
    attached: () => attachedTurzxPanels(),
    open: () => openTurzxPanel(),
  },
];
```
Add it to `panel-families.ts`'s aggregation.

- [ ] **Step 6: Test the registry seam**

Add to `panel-families.test.ts`:
```ts
it("claims the TURZX serial family and its support record", () => {
  expect(familyFor(0x1d6b, 0x0106)?.id).toBe("turzx-5");
  expect(familyFor(0x1d6b, 0x0106)?.support.supportedFirmware).toEqual(["1.88"]);
});
```
Run it; expected PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/host/src/panels/serial-transport.ts \
  src/web/packages/host/src/panels/turzx-panel.ts \
  src/web/packages/host/src/panels/turzx-panel.test.ts \
  src/web/packages/host/src/panels/panel-families.ts \
  src/web/packages/host/src/panels/panel-families.test.ts
git commit -m "feat(panels): drive the TURZX 5-inch panel over serial"
```

### Task 4: In-flight guard and a static frame on the glass

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-runner.ts`
- Test: `src/web/packages/host/src/panels/panel-runner.test.ts`

**Interfaces:**
- `PanelRunner.tick()` returns `false` when a previous tick is still capturing or sending; it never starts a second one concurrently.

- [ ] **Step 1: Write the failing test**

```ts
it("does not start a second capture while one is in flight", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const capture = vi.fn(async () => { await gate; return RED; });
  const present = vi.fn(async () => {});
  const device: PanelDevice = {
    geometry: { width: 4, height: 4 },
    open: async () => {},
    present,
    close: async () => {},
  };
  const runner = createPanelRunner({ device, rasterizer: { capture, close: async () => {} } });

  const first = runner.tick();
  await expect(runner.tick()).resolves.toBe(false);
  release?.();
  await expect(first).resolves.toBe(true);

  expect(capture).toHaveBeenCalledTimes(1);
  expect(present).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
npx vitest run packages/host/src/panels/panel-runner.test.ts
```
Expected: FAIL — two captures start.

- [ ] **Step 3: Implement the guard**

Add `let inFlight = false;` to the runner closure. At the top of `tick`, return `false` when `inFlight`; otherwise set it, and clear it in a `finally` around the existing body.

- [ ] **Step 4: Run the runner and registry tests**

```bash
npx vitest run packages/host/src/panels/panel-runner.test.ts packages/host/src/panels/panel-families.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Verify a static frame on the attached panel**

Build the host, run `node packages/host/bin/yunari.js --no-browser` from `src/web/`, open Host settings, add the TURZX panel, assign a static theme, and confirm the panel shows it upright. Record the observation in the commit message; if it fails, do not commit — report the panel's reply.

- [ ] **Step 6: Run the full gate at the phase boundary and record its exit code**

From `src/web/`, without piping:
```bash
npm run gate > /tmp/yunari-gate-phase1.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`. A non-zero code blocks the commit.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/host/src/panels/panel-runner.ts \
  src/web/packages/host/src/panels/panel-runner.test.ts
git commit -m "fix(panels): skip a tick while a frame is in flight"
```

---

## Plan Phase 2 — Support record and controls

### Task 5: Support metadata in the panels response and surface

**Files:**
- Modify: `src/web/packages/host/src/server.ts` (`GET /api/displays/panels`)
- Modify: `src/web/packages/editor/src/host-settings-mode/client.ts`
- Modify: `src/web/packages/editor/src/host-settings-mode/panels-section.tsx`
- Modify: `src/web/packages/editor/src/host-settings-mode/region.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Test: `src/web/packages/host/src/server.test.ts`, `src/web/packages/editor/src/host-settings-mode/region.dom.test.tsx`

**Interfaces:**
- The panels GET item gains:
```ts
{
  readonly held: boolean;
  readonly heldId?: string;
  readonly support?: {
    readonly maker: string;
    readonly hardwareRevision: string;
    readonly supportedFirmware: readonly string[];
    readonly updatedAt: string;
  };
  readonly model?: string;
  readonly firmware?: string;
  readonly commands: readonly string[];
}
```
- `client.ts`'s `PanelHint` gains `heldId?: string`, `support?`, `model?`, `firmware?`, `commands: readonly PanelCommandKind[]`, and `client.ts` declares the mirrored union, as it already mirrors `PanelHardware`:
```ts
export type PanelCommandKind = "brightness" | "screen" | "restart" | "status" | "hello";
```
- Consumes: Task 2's `PanelFamily.support` and `.commands`; Task 3's hint `model`/`firmware`.

- [ ] **Step 1: Write the failing server test**

In `server.test.ts`, extend the panels GET case:
```ts
expect(attached.json()).toEqual({
  panels: [{
    ...ATTACHED_PANEL,
    held: false,
    commands: [],
    support: {
      maker: "Lian Li",
      hardwareRevision: '9.2"',
      supportedFirmware: [],
      updatedAt: "2026-10-28",
    },
  }],
});
```
Use the exact support values the implemented rows carry; update this expectation to match Task 2's rows. After adding a record, re-fetch the panels list and assert the same item now carries `heldId: "strip"`:
```ts
const afterAdd = await request(hosting.server, "GET", "/api/displays/panels");
expect((afterAdd.json() as { panels: { heldId?: string }[] }).panels[0]?.heldId).toBe("strip");
```

- [ ] **Step 2: Run it and see it fail**

```bash
npx vitest run packages/host/src/server.test.ts -t "answers what is attached"
```
Expected: FAIL — `commands`/`support`/`heldId` are absent.

- [ ] **Step 3: Implement the response fields**

In the panels GET, look up `familyFor(panel.vendorId, panel.productId)`; include `commands: family?.commands ?? []` and `support: family?.support` only when present. Compute `heldId` from the same record scan that computes `held`.

- [ ] **Step 4: Write the failing editor test**

In `region.dom.test.tsx`, render a panel hint with `heldId: "panel-1"`, `support`, `firmware: "1.90"`, `supportedFirmware: ["1.88"]`, and select that display. Assert the row shows maker/revision and a warning naming `1.90` and `1.88`.

- [ ] **Step 5: Implement the client and the section**

- `readPanelHints` reads the new fields, dropping malformed support.
- `PanelsSection` renders a second line per attached panel: `maker · hardwareRevision · firmware (supported: …)`; the mismatch warning uses the new `uiCopy.hostSettings.panels.mismatch(detected, supported)`.
- `region.tsx` selects the attached panel that matches the chosen display (`heldId === display.id`) and passes it to the section (or renders the same line in the displays group).
- Copy adds: `maker`, `revision`, `supportedFirmware`, `detectedFirmware`, `updated`, `mismatch`.

- [ ] **Step 6: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/server.test.ts packages/editor/src/host-settings-mode/region.dom.test.tsx
npm run typecheck -w @yunari/host
npx tsc --noEmit -p packages/editor/tsconfig.json
```
Expected: PASS; both typechecks exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts \
  src/web/packages/editor/src/host-settings-mode/client.ts \
  src/web/packages/editor/src/host-settings-mode/panels-section.tsx \
  src/web/packages/editor/src/host-settings-mode/region.tsx \
  src/web/packages/editor/src/host-settings-mode/region.dom.test.tsx \
  src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(panels): show the hardware support record and firmware mismatch"
```

### Task 6: Controls in the adapter and the manager

**Files:**
- Modify: `src/web/packages/host/src/panels/turzx-panel.ts`
- Modify: `src/web/packages/host/src/panels/panel-manager.ts`
- Test: `src/web/packages/host/src/panels/turzx-panel.test.ts`, `src/web/packages/host/src/panels/panel-manager.test.ts` (create if absent)

**Interfaces:**
- `PanelDevice.controls` on the TURZX device:
```ts
{
  commands: ["brightness", "screen", "restart", "status", "hello"],
  run(command: PanelCommand): Promise<string>
}
```
- `PanelManager` gains `command(displayId: string, command: PanelCommand): Promise<string>` and exports `class PanelNotRunningError extends Error`.
- Consumes: Task 2's `PanelCommand`, `PanelControls`.

- [ ] **Step 1: Write the failing adapter tests**

```ts
// Reuse Task 3's fakeTransport and an `opened()` helper that builds a panel
// over a transport that already answered HELLO.
it("maps percent brightness to the panel's 0-255 byte", async () => {
  const { writes, transport } = fakeTransport("chs_5inch.dev1_rom1.88");
  const panel = await opened(transport);
  await panel.controls!.run({ kind: "brightness", level: 50 });
  const last = writes[writes.length - 1]!;
  expect([...last.slice(0, 10)]).toEqual([0x7b, 0xef, 0x69, 0, 0, 0, 1, 0, 0, 0]);
  expect(last[10]).toBe(128);
});

it("refuses a level outside 0-100 or a fraction", async () => {
  const panel = await opened(fakeTransport("chs_5inch.dev1_rom1.88").transport);
  await expect(panel.controls!.run({ kind: "brightness", level: 101 })).rejects.toThrow(/0 to 100/);
  await expect(panel.controls!.run({ kind: "brightness", level: 50.5 })).rejects.toThrow(/whole/);
});

it("returns the status and HELLO replies as text", async () => {
  const { transport } = fakeTransport(
    "chs_5inch.dev1_rom1.88",
    "needReSend:0|renderCnt:1",
  );
  const panel = await opened(transport);
  await expect(panel.controls!.run({ kind: "status" })).resolves.toBe(
    "needReSend:0|renderCnt:1",
  );
});
```
For the manager:
```ts
it("refuses a command for a display with no running runner", async () => {
  // The same fake `displays` and options the manager's existing tests build.
  const manager = managerForTest();
  await expect(manager.command("panel-1", { kind: "status" })).rejects.toBeInstanceOf(
    PanelNotRunningError,
  );
});
```
If `panel-manager.test.ts` is new, add the smallest `managerForTest()` that satisfies `createPanelManager` and reuse it in Task 12; do not widen production types for it.
The successful delegation is covered by the adapter test above and by the route test with a fake manager in Task 7; do not add a production test seam to reach a started runner.

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/panels/turzx-panel.test.ts packages/host/src/panels/panel-manager.test.ts
```
Expected: FAIL — `controls` and `command` do not exist.

- [ ] **Step 3: Implement**

- In `turzx-panel.ts`, build the `controls` object returning the same serialized queue. Brightness validates `Number.isInteger(level) && level >= 0 && level <= 100`, then writes `frame([...TURZX_COMMAND.brightness, Math.round(level / 100 * 255)])`. Screen writes on/off; restart writes restart and returns `"The panel is restarting; it will be unavailable for about 15 seconds."`; status and hello write then read 1024 bytes and return the trimmed text.
- In `panel-manager.ts`, keep the device on the entry when `run()` opens it; `command` finds the entry, throws `PanelNotRunningError` when absent or the device has no `controls`, and otherwise delegates.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/panels/turzx-panel.test.ts packages/host/src/panels/panel-manager.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels/turzx-panel.ts \
  src/web/packages/host/src/panels/turzx-panel.test.ts \
  src/web/packages/host/src/panels/panel-manager.ts \
  src/web/packages/host/src/panels/panel-manager.test.ts
git commit -m "feat(panels): expose the TURZX hardware controls"
```

### Task 7: The panel command route

**Files:**
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- `POST /api/displays/:id/panel/command` with `{ kind, level?, on? }`.
- 200 `{ ok: true, reply }`; 404 unknown display; 400 not a panel; 400 bad body/unsupported kind/bad level; 409 `PanelNotRunningError`; 405 for other methods.
- Consumes: Task 6's `PanelManager.command`, `PanelNotRunningError`.

- [ ] **Step 1: Write the failing route tests**

Extend the existing `a USB panel` describe block. `PanelManager` now requires `command`, so `managerOver` gains `command: () => Promise.resolve("")`; the cases below override it. `COMMAND` is valid because adding a panel labelled `Strip` yields the id `strip`:
```ts
const COMMAND = "/api/displays/strip/panel/command";

it("sends a command and returns the panel's reply", async () => {
  const called: unknown[] = [];
  const hosting = host({
    attachedPanels: () => Promise.resolve(ATTACHED_PANELS),
    panels: {
      ...managerOver([], []),
      command: (id, command) => {
        called.push({ id, command });
        return Promise.resolve("ok");
      },
    },
  });
  try {
    await request(hosting.server, "POST", "/api/displays/panels", json({ label: "Strip", panel: STRIP }));
    const answer = await request(hosting.server, "POST", COMMAND, json({ kind: "brightness", level: 50 }));
    expect(answer.status).toBe(200);
    expect(answer.json()).toEqual({ ok: true, reply: "ok" });
    expect(called).toEqual([{ id: "strip", command: { kind: "brightness", level: 50 } }]);
  } finally {
    await hosting.close();
  }
});

it.each([
  ["an out-of-range level", { kind: "brightness", level: 101 }],
  ["a negative level", { kind: "brightness", level: -1 }],
  ["a fractional level", { kind: "brightness", level: 50.5 }],
  ["a missing level", { kind: "brightness" }],
  ["an unknown kind", { kind: "reboot" }],
  ["a missing on", { kind: "screen" }],
])("refuses %s with 400 and sends nothing", async (_name, body) => {
  const command = vi.fn();
  const hosting = host({
    attachedPanels: () => Promise.resolve(ATTACHED_PANELS),
    panels: { ...managerOver([], []), command },
  });
  try {
    await request(hosting.server, "POST", "/api/displays/panels", json({ label: "Strip", panel: STRIP }));
    const answer = await request(hosting.server, "POST", COMMAND, json(body));
    expect(answer.status).toBe(400);
    expect(command).not.toHaveBeenCalled();
  } finally {
    await hosting.close();
  }
});

it("answers 400 for a non-panel record and 404 for an unknown one", async () => {
  const hosting = host({ panels: managerOver([], []) });
  try {
    const listed = (await request(hosting.server, "GET", "/api/displays")).json() as {
      displays: { id: string; kind: string }[];
    };
    const local = listed.displays.find((display) => display.kind === "local")!;
    const notPanel = await request(hosting.server, "POST", `/api/displays/${local.id}/panel/command`, json({ kind: "status" }));
    expect(notPanel.status).toBe(400);

    const unknown = await request(hosting.server, "POST", "/api/displays/nope/panel/command", json({ kind: "status" }));
    expect(unknown.status).toBe(404);
  } finally {
    await hosting.close();
  }
});

it("answers 409 when the runner is not holding the device", async () => {
  const hosting = host({
    attachedPanels: () => Promise.resolve(ATTACHED_PANELS),
    panels: {
      ...managerOver([], []),
      command: () => Promise.reject(new PanelNotRunningError("Panel display strip is not running.")),
    },
  });
  try {
    await request(hosting.server, "POST", "/api/displays/panels", json({ label: "Strip", panel: STRIP }));
    const answer = await request(hosting.server, "POST", COMMAND, json({ kind: "status" }));
    expect(answer.status).toBe(409);
  } finally {
    await hosting.close();
  }
});
```
The `host()` fixture already seeds a local display; read it from the list rather than assuming its id.

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/server.test.ts -t "panel command"
```
Expected: FAIL — 404/405.

- [ ] **Step 3: Implement the route**

Inside the displays block, after the panels POST, match `/^\/api\/displays\/([^/]+)\/panel\/command$/`, decode the id, and require POST. Validate the display (`displays.find`), kind, and body before calling `options.panels?.command`. Map `PanelNotRunningError` to 409. Add the path to the 405 `supported` mapping as `"POST"`.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/server.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts
git commit -m "feat(panels): add the hardware command route"
```

### Task 8: The controls dialog

**Files:**
- Create: `src/web/packages/editor/src/host-settings-mode/panel-controls-section.tsx`
- Modify: `src/web/packages/editor/src/host-settings-mode/client.ts`
- Modify: `src/web/packages/editor/src/host-settings-mode/region.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Test: `src/web/packages/editor/src/host-settings-mode/panel-controls.dom.test.tsx`

**Interfaces:**
- `SettingsClient` gains `panelCommand(id: string, command: EditorPanelCommand): Promise<string>`.
```ts
export type EditorPanelCommand =
  | { readonly kind: "brightness"; readonly level: number }
  | { readonly kind: "screen"; readonly on: boolean }
  | { readonly kind: "restart" }
  | { readonly kind: "status" }
  | { readonly kind: "hello" };
```
- `PanelControlsSection` props:
```ts
{
  readonly displayId: string;
  readonly panel: PanelHint;
  readonly onCommand: (command: EditorPanelCommand) => Promise<string>;
}
```
It renders nothing unless `panel.heldId === displayId` and `panel.commands.length > 0`, so its own contract is testable without the whole region.
- Consumes: Task 5's `PanelHint`, Task 7's route.

- [ ] **Step 1: Write the failing DOM tests**

```tsx
const CONTROLLABLE: PanelHint = {
  vendorId: 0x1d6b, productId: 0x0106, serial: "S1", label: 'TURZX 5" Panel',
  held: true, heldId: "panel-1", commands: ["brightness", "screen", "restart", "status", "hello"],
  model: "chs_5inch", firmware: "1.88",
  support: { maker: "TURZX", hardwareRevision: "Rev C", supportedFirmware: ["1.88"], updatedAt: "2026-10-29" },
};

it("renders nothing for a panel another display holds", () => {
  const { container } = render(
    <PanelControlsSection displayId="panel-2" panel={CONTROLLABLE} onCommand={async () => "ok"} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("sends brightness as a whole percent and shows the reply", async () => {
  const onCommand = vi.fn(async () => "ok");
  render(<PanelControlsSection displayId="panel-1" panel={CONTROLLABLE} onCommand={onCommand} />);
  await user.click(screen.getByRole("button", { name: /controls/i }));
  const level = screen.getByLabelText(/brightness/i);
  await user.clear(level);
  await user.type(level, "50");
  await user.click(screen.getByRole("button", { name: /apply/i }));
  expect(onCommand).toHaveBeenCalledWith({ kind: "brightness", level: 50 });
  expect(await screen.findByText("ok")).toBeVisible();
});

it("blocks a level above 100 without calling the host", async () => {
  const onCommand = vi.fn(async () => "ok");
  render(<PanelControlsSection displayId="panel-1" panel={CONTROLLABLE} onCommand={onCommand} />);
  await user.click(screen.getByRole("button", { name: /controls/i }));
  const level = screen.getByLabelText(/brightness/i);
  await user.clear(level);
  await user.type(level, "101");
  await user.click(screen.getByRole("button", { name: /apply/i }));
  expect(onCommand).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(/0 to 100/);
});

it("asks before restarting", async () => {
  const onCommand = vi.fn(async () => "The panel is restarting; it will be unavailable for about 15 seconds.");
  render(<PanelControlsSection displayId="panel-1" panel={CONTROLLABLE} onCommand={onCommand} />);
  await user.click(screen.getByRole("button", { name: /controls/i }));
  await user.click(screen.getByRole("button", { name: /^restart$/i }));
  expect(onCommand).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /confirm/i }));
  expect(onCommand).toHaveBeenCalledWith({ kind: "restart" });
});

it("warns when the firmware is outside the supported set", () => {
  render(
    <PanelControlsSection
      displayId="panel-1"
      panel={{ ...CONTROLLABLE, firmware: "1.90" }}
      onCommand={async () => "ok"}
    />,
  );
  expect(screen.getByText(/1\.90/)).toBeVisible();
  expect(screen.getByText(/1\.88/)).toBeVisible();
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/editor/src/host-settings-mode/panel-controls.dom.test.tsx
```
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Implement**

- Add `panelCommand` to `client.ts` (POST, parse `{ reply }`, throw `refusal` on failure).
- Build the section: a `Group` with a "Controls" button that opens the shared `Dialog`; the dialog holds brightness (number input, Apply), screen on/off, restart with a two-step confirm, status/identify buttons, the support/firmware line with the mismatch warning, the last reply, and inline errors.
- Render it in `region.tsx` under `DisplayPresentationSection` when the selected display matches an attached panel with non-empty `commands`.
- Add the copy under `uiCopy.hostSettings.panels.controls`.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/editor/src/host-settings-mode/panel-controls.dom.test.tsx
npx tsc --noEmit -p packages/editor/tsconfig.json
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Verify on the attached panel**

Open the controls, set brightness to 50, turn the screen off and on, and query status. Record the observed replies in the commit message. Restart only if the panel can be recovered — it drops for ~15 s.

- [ ] **Step 6: Run the full gate at the spec's Phase 1 boundary and record its exit code**

From `src/web/`, without piping:
```bash
npm run gate > /tmp/yunari-gate-spec-phase1.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`. A non-zero code blocks the commit.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/editor/src/host-settings-mode/panel-controls-section.tsx \
  src/web/packages/editor/src/host-settings-mode/panel-controls.dom.test.tsx \
  src/web/packages/editor/src/host-settings-mode/client.ts \
  src/web/packages/editor/src/host-settings-mode/region.tsx \
  src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(panels): add the hardware controls dialog"
```

---

## Plan Phase 3 — Video overlay

**External dependency:** the Lian Li worktree is implementing the shared video-background seam — deciding whether a display's theme video reaches a panel and how the runner switches mode. Before Task 9, merge that work and read its interfaces. Reuse its seam; implement here only the TURZX-specific pieces (transcode/upload/start, transparent capture flag, overlay diff encoding) and its adapter wiring. Where this plan and that seam name the same thing differently, keep the landed names and update Tasks 9, 10 and 12 accordingly; do not build a second video-mode path. If the seam has not landed by the time Phase 3 starts, Task 12's `videoFor`/`mode` design is the fallback, not the default.

### Task 9: Transcode, upload and start a theme video

**Files:**
- Create: `src/web/packages/host/src/panels/turzx-video.ts`
- Modify: `src/web/packages/host/src/panels/turzx-panel.ts`
- Test: `src/web/packages/host/src/panels/turzx-video.test.ts`

**Interfaces:**
- Produces:
```ts
export type TranscodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };
export async function transcodeForPanel(
  bytes: Uint8Array,
  options?: {
    readonly ffmpegPath?: string;
    readonly run?: (args: readonly string[]) => Promise<{ code: number; stderr: string }>;
    readonly verifyForTest?: boolean;
  },
): Promise<TranscodeResult>;
```
- The TURZX device gains `video` implementing Task 2's `PanelVideo`:
  - `start(mp4)` transcodes, uploads when the device size differs, starts playback, initializes the transparent overlay, waits ≥1500 ms, and records the remote path.
  - `stop()` writes STOP_VIDEO.
- `TurzxOptions` gains `readonly transcode?: (bytes: Uint8Array) => Promise<TranscodeResult>`, defaulting to `transcodeForPanel`, so the upload path is testable without spawning ffmpeg.
- Consumes: Task 1's codec and commands, Task 2's `PanelVideo`.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a transcode the encoder failed", async () => {
  const result = await transcodeForPanel(Uint8Array.of(1), {
    run: async () => ({ code: 1, stderr: "" }),
    verifyForTest: true,
  });
  expect(result.ok).toBe(false);
});

it("uploads only when the device size differs, then starts and inits", async () => {
  const { writes, transport } = fakeTransport(
    "chs_5inch.dev1_rom1.88", // HELLO
    "0", // GET_FILE_SIZE: nothing stored yet
    "create_success", // UPLOAD_FILE
    "play_video_success", // START_VIDEO
    "seq_png_init_sucessneedReSend:0|renderCnt:1", // INIT_VIDEO_OVERLAY
  );
  const panel = await opened(transport, {
    transcode: async () => ({ ok: true, bytes: Uint8Array.of(9, 9, 9) }),
  });

  await panel.video!.start(Uint8Array.of(1, 2, 3));

  const upload = writes.find((bytes) => bytes[0] === 0x6f && bytes[1] === 0xef);
  expect(upload).toBeDefined();
  expect(writes.some((bytes) => bytes[0] === 0x78 && bytes[1] === 0xef)).toBe(true);
  expect(writes.some((bytes) => bytes[0] === 0xd0 && bytes[1] === 0xef)).toBe(true);
  expect(writes.every((bytes) => bytes.length % 250 === 0)).toBe(true);
  // A three-byte clip is one 250-byte chunk carrying those bytes.
  const chunks = writes.filter(
    (bytes) => bytes.length === 250 && bytes[0] === 9 && bytes[1] === 9 && bytes[2] === 9,
  );
  expect(chunks).toHaveLength(1);
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/panels/turzx-video.test.ts
```
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

- `transcodeForPanel` reuses `verifyFfmpeg` and the bundled `ffmpeg-static`, writing to a temp directory. It hashes the source, and when `panels/<hash>.mp4` already exists in the host's data directory it returns those bytes without spawning ffmpeg. Args: `-an`, `-vf scale=800:480:force_original_aspect_ratio=increase:force_divisible_by=2,crop=800:480`, `-r 30`, `-c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -movflags +faststart -f mp4`. A non-zero exit is `{ ok: false }`.
- In the adapter, `start` computes the SHA-256 of the transcoded bytes, uses `/mnt/SDCARD/video/yunari-<first 16 hex>.mp4`, checks GET_FILE_SIZE, deletes a stale file, uploads in 249-byte padded chunks, starts, sends PRE_UPDATE, START_BITMAP, DISPLAY_ON_VIDEO, a transparent full image, INIT_VIDEO_OVERLAY with `[0x02]`, and a raw `ef 69` payload; waits 1500 ms; sends QUERY_STATUS; keeps the transparent frame as the previous overlay.
- After a successful start, DELETE_FILE the previous remote path when it differs.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/panels/turzx-video.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels/turzx-video.ts \
  src/web/packages/host/src/panels/turzx-video.test.ts \
  src/web/packages/host/src/panels/turzx-panel.ts
git commit -m "feat(panels): upload and start a theme video on the panel"
```

### Task 10: Transparent overlay capture and first-frame glass

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-raster.ts`
- Modify: `src/web/packages/scene-fabric/src/background-media.ts`
- Modify: `src/web/packages/scene-fabric/src/scene.ts`
- Modify: `src/web/packages/player/src/main.ts`
- Test: `src/web/packages/host/src/panels/panel-raster.test.ts`, `src/web/packages/scene-fabric/src/background-media.dom.test.ts` (create either if absent)

**Interfaces:**
- `RasterOptions` gains `readonly transparent?: boolean`; when true, `capture()` returns PNG from a transparent-background screenshot.
- `BackgroundMediaOptions` gains `readonly visible?: boolean` and `readonly still?: boolean`; `still` pauses a video at time 0 and keeps it sampleable for glass, `visible: false` sets the layer's opacity to 0.
- Scene options forward both as `mediaVisible` and `mediaStill`.
- The player reads `panelOverlay=1` and passes them when mounting.

- [ ] **Step 1: Write the failing tests**

```ts
it("captures PNG only when the overlay mode asks for transparency", () => {
  expect(screenshotParameters(true)).toEqual({ format: "png" });
  expect(screenshotParameters(false)).toEqual({ format: "jpeg", quality: 85 });
});
```

```ts
it("holds a still video invisible in overlay mode", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const handle = mountBackgroundMedia(host, {
    // Whatever `scene.ts`'s mount already passes for a video asset, plus:
    visible: false,
    still: true,
  });
  const video = host.querySelector("video")!;
  video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();

  expect(video.paused).toBe(true);
  expect(video.currentTime).toBe(0);
  expect(handle.layer.style.opacity).toBe("0");
});
```
Assert the layer on the element the handle already exposes for glass; if none is public, add `readonly layer: HTMLElement` to `BackgroundMediaHandle` rather than querying by a new attribute.

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/panels/panel-raster.test.ts packages/scene-fabric/src/background-media.dom.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

- `createRasterizer` sends `Emulation.setDefaultBackgroundColorOverride` with a transparent colour before navigation when `transparent`, and `capture()` uses the shared parameter function.
- `mountBackgroundMedia`: keep the layer's `opacity` at `"0"` when `visible === false`; when `still === true` and the media is a video, set `currentTime = 0` and pause on `loadeddata`, and never arm the frame loop.
- `scene.ts` forwards `mediaVisible`/`mediaStill`; the player's `panelOverlay` flag supplies `false`/`true`.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/panels/panel-raster.test.ts packages/scene-fabric/src/background-media.dom.test.ts
npm run typecheck -w @yunari/host -w @yunari/scene-fabric -w @yunari/player
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Browser evidence**

Run the player with a video theme and `?panelOverlay=1`; capture a screenshot and confirm the video area is transparent and the UI is present. Record the artifact path in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/host/src/panels/panel-raster.ts \
  src/web/packages/host/src/panels/panel-raster.test.ts \
  src/web/packages/scene-fabric/src/background-media.ts \
  src/web/packages/scene-fabric/src/background-media.dom.test.ts \
  src/web/packages/scene-fabric/src/scene.ts \
  src/web/packages/player/src/main.ts
git commit -m "feat(panels): capture a transparent UI overlay"
```

### Task 11: Overlay diff encoder and `presentOverlay`

**Files:**
- Modify: `src/web/packages/host/src/panels/turzx-protocol.ts`
- Modify: `src/web/packages/host/src/panels/turzx-panel.ts`
- Test: `src/web/packages/host/src/panels/turzx-protocol.test.ts`, `src/web/packages/host/src/panels/turzx-panel.test.ts`

**Interfaces:**
- Produces:
```ts
export interface OverlayUpdate {
  readonly imageSize: number;
  readonly visibleBytes: number;
  readonly body: Uint8Array; // unframed payload including its trailer
}
export function overlayTrailer(unframedLength: number): {
  readonly bytes: Uint8Array;
  readonly extra: number;
};
export function overlayUpdate(
  previous: Uint8Array,
  current: Uint8Array,
  geometry: { readonly width: number; readonly height: number },
): OverlayUpdate;
```
`overlayTrailer` owns the device's alignment quirk in one testable place: below 250 bytes it is `ef 69` and `extra: 0`; at 0, 248 or 249 modulo 250 above 250 it is `00 00 00 01 00 00 ef 69` and `extra: 7`.

- `presentOverlay(png)` decodes, builds an update against the stored previous overlay, frames `UPDATE_BITMAP` + the body, sends both, then stores the current frame.
- Consumes: Task 9's `video` state.

- [ ] **Step 1: Write the failing golden tests**

```ts
function blank(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function red(width: number, height: number, rect: { x: number; y: number; w: number; h: number }): Uint8Array {
  const pixels = blank(width, height);
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = 255; pixels[i + 2] = 0; pixels[i + 3] = 255;
    }
  }
  return pixels;
}

it("encodes a new rectangle as its pixels plus a visible segment", () => {
  const update = overlayUpdate(blank(4, 2), red(4, 2, { x: 1, y: 0, w: 2, h: 1 }), {
    width: 4, height: 2,
  });
  // One row-0 changed segment: offset 3 bytes, width 2, then 2 pixels of 3 bytes.
  expect([...update.body.slice(0, 5)]).toEqual([0, 0, 1, 0, 2]);
  // The visible list repeats that segment after the changed pixels.
  expect([...update.body.slice(11, 16)]).toEqual([0, 0, 1, 0, 2]);
  expect(update.visibleBytes).toBe(5);
  expect(update.imageSize).toBe(5 + 6 + 5 + 2);
});

it("drops the old position from the visible list", () => {
  const update = overlayUpdate(
    red(4, 2, { x: 0, y: 0, w: 2, h: 1 }),
    red(4, 2, { x: 2, y: 0, w: 2, h: 1 }),
    { width: 4, height: 2 },
  );
  // A cleared pixel is not re-sent: only the new rectangle appears, and the
  // visible list names x=2 alone, which is what clears x=0.
  expect([...update.body.slice(0, 5)]).toEqual([0, 0, 2, 0, 2]);
  expect([...update.body.slice(11, 16)]).toEqual([0, 0, 2, 0, 2]);
});

it.each([
  [250, 2, 0],
  [251, 2, 0],
  [300, 2, 0],
  [500, 8, 7],
  [498, 8, 7],
  [499, 8, 7],
])("aligns a %i-byte payload", (length, size, extra) => {
  const trailer = overlayTrailer(length);
  expect(trailer.bytes.length).toBe(size);
  expect(trailer.extra).toBe(extra);
  expect([...trailer.bytes.slice(-2)]).toEqual([0xef, 0x69]);
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/panels/turzx-protocol.test.ts -t overlay
```
Expected: FAIL.

- [ ] **Step 3: Implement the encoder**

Port the verified algorithm: per row, changed non-transparent segments encode `offset(3) + width(2) + 3 bytes of 4-bit BGRA`; then the current overlay's visible segments encode `offset(3) + width(2)`; the hex string is chunked at 249 bytes with a `0x00` between chunks, and only when it exceeds 500 hex characters; the trailer comes from `overlayTrailer`. `imageSize` is the unframed length plus `trailer.extra`; when `trailer.extra` is 7, `visibleBytes` gains 5 as well. Use `geometry.width` as the row stride. Throw when either frame's length is not `width * height * 4`; a short decode must not be indexed as a full frame.

- [ ] **Step 4: Implement `presentOverlay`**

Decode the PNG with `decodeStill` into RGBA, build the update, frame the header with a monotonically increasing count and the body, write both through the serialized queue, then replace the stored previous overlay.

- [ ] **Step 5: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/panels/turzx-protocol.test.ts packages/host/src/panels/turzx-panel.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/host/src/panels/turzx-protocol.ts \
  src/web/packages/host/src/panels/turzx-protocol.test.ts \
  src/web/packages/host/src/panels/turzx-panel.ts \
  src/web/packages/host/src/panels/turzx-panel.test.ts
git commit -m "feat(panels): send overlay diff updates to the panel"
```

### Task 12: Video mode in the runner, fallback, and hardware proof

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-runner.ts`
- Modify: `src/web/packages/host/src/panels/panel-manager.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Modify: `src/web/packages/host/src/server.ts` (active-theme route)
- Test: `src/web/packages/host/src/panels/panel-runner.test.ts`, `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- `PanelRunnerOptions` gains `readonly mode?: "still" | "overlay"`; in `"overlay"` the runner captures and calls `device.video!.presentOverlay(capture)`.
- `PanelManagerOptions` gains `readonly videoFor?: (displayId: string) => Promise<Uint8Array | undefined>`.
- `PanelManager` gains `refresh(displayId: string): Promise<void>` (stop, then start), called after an active-theme write for a panel display.
- Consumes: Tasks 9–11.

- [ ] **Step 1: Write the failing tests**

```ts
it("sends overlay captures through presentOverlay in overlay mode", async () => {
  const presentOverlay = vi.fn(async () => {});
  const present = vi.fn(async () => {});
  const device: PanelDevice = {
    geometry: { width: 4, height: 4 },
    open: async () => {}, present, close: async () => {},
    video: { start: async () => {}, presentOverlay, stop: async () => {} },
  };
  const rasterizer = { capture: vi.fn(async () => Uint8Array.of(1)), close: async () => {} };
  const runner = createPanelRunner({ device, rasterizer, mode: "overlay" });
  await expect(runner.tick()).resolves.toBe(true);
  expect(presentOverlay).toHaveBeenCalledTimes(1);
  expect(present).not.toHaveBeenCalled();
});

it("leaves the still mode as the default", async () => {
  const present = vi.fn(async () => {});
  const presentOverlay = vi.fn(async () => {});
  const device: PanelDevice = {
    geometry: { width: 4, height: 4 },
    open: async () => {}, present, close: async () => {},
    video: { start: async () => {}, presentOverlay, stop: async () => {} },
  };
  const rasterizer = { capture: vi.fn(async () => Uint8Array.of(1)), close: async () => {} };

  await createPanelRunner({ device, rasterizer }).tick();

  expect(present).toHaveBeenCalledTimes(1);
  expect(presentOverlay).not.toHaveBeenCalled();
});
```

The fallback from a failed video start is verified on the panel (Step 5), because reaching it needs the manager to open a real device; a unit seam for that would exist only for the test.

Add the route case to `server.test.ts`'s `a USB panel` block. `managerOver` gains `refresh: (id) => { refreshed.push(id); return Promise.resolve(); }`:
```ts
it("restarts the runner when a different theme is assigned", async () => {
  const refreshed: string[] = [];
  const hosting = host({
    attachedPanels: () => Promise.resolve(ATTACHED_PANELS),
    panels: { ...managerOver([], []), refresh: (id) => { refreshed.push(id); return Promise.resolve(); } },
  });
  try {
    await request(hosting.server, "POST", "/api/displays/panels", json({ label: "Strip", panel: STRIP }));
    // The theme-assignment route the existing display tests already use.
    await request(hosting.server, "PUT", "/api/displays/strip/theme", json({ theme: "night" }));
    expect(refreshed).toEqual(["strip"]);
  } finally {
    await hosting.close();
  }
});
```
Read the assignment route and body from the tests that already exercise it; if it is a PATCH, use that method.

- [ ] **Step 2: Run them and see them fail**

```bash
npx vitest run packages/host/src/panels/panel-runner.test.ts packages/host/src/server.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the runner mode and the manager's video path**

- Runner: branch on `mode` in `tick`; the byte comparison still uses the capture.
- Manager: at `run()`, ask `videoFor(displayId)`; when it answers and the device has `video`, `await device.video.start(bytes)`, build the rasterizer with `transparent: true` and a URL carrying `panelOverlay=1`, and create the runner with `mode: "overlay"`. If `start` throws, report once and build the static runner instead.
- `stop()` calls `device.video.stop()` before `close()`.
- `refresh` stops and starts the display; call it from `server.ts` after `activeTheme.write(key, id)` when `key` is a panel display.

- [ ] **Step 4: Run the tests and make them pass**

```bash
npx vitest run packages/host/src/panels/panel-runner.test.ts packages/host/src/server.test.ts
npm run typecheck -w @yunari/host
```
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Verify on the attached panel**

Upload a short 800×480 clip through a theme with a video background; confirm it plays, the UI overlay draws, a moving element clears its old pixels, and glass shows frame 0. Then force a start failure (use a clip the device rejects) and confirm the panel falls back to a static frame with one console error. Record both observations in the commit message.

- [ ] **Step 6: Run the full gate and record its exit code**

From `src/web/`, without piping:
```bash
npm run gate > /tmp/yunari-gate.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`. A non-zero code blocks the commit.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/host/src/panels/panel-runner.ts \
  src/web/packages/host/src/panels/panel-runner.test.ts \
  src/web/packages/host/src/panels/panel-manager.ts \
  src/web/packages/host/src/main.ts src/web/packages/host/src/server.ts \
  src/web/packages/host/src/server.test.ts
git commit -m "feat(panels): play a theme video on the panel with a UI overlay"
```
