# Hardware

Device-level knowledge recovered by probing hardware and decompiling vendor
applications. This directory exists so a future agent or developer does not
repeat an expensive investigation: **every fact here cost a measurement, a
crash or a decompilation to learn.**

| Device | Document | USB | Transport | Driver |
|---|---|---|---|---|
| Lian Li 9.2" LCD, Universal Screen 8.8" | [`lian-li-tur-usb.md`](lian-li-tur-usb.md) | `1cbe:a092`, `1cbe:a088` | USB bulk, DES-encrypted 512-byte frames | `tur-usb-panel.ts` |
| NZXT Kraken Z53/Z63/Z73 | [`nzxt-kraken-z.md`](nzxt-kraken-z.md) | `1e71:3008` | HID control + bulk data | `kraken-z3-panel.ts` |
| TURZX 5" (Rev C) | [`turzx-serial.md`](turzx-serial.md) | `1d6b:0106` | USB CDC serial at 115200 | `turzx-panel.ts` |

The driver paths are relative to `src/web/packages/host/src/panels/`. The port
and registry that sit above every driver are described in
[`../architecture.md`](../architecture.md).

## What belongs in a device document

Everything expensive to rediscover:

- USB IDs, interfaces, endpoints, report sizes and which OS driver owns what.
- Packet and framing layout, opcodes and their fields, byte order.
- Handshakes, reply text and the meaning of status bytes.
- Pixel formats, media encoding, geometry and rotation.
- Timing constraints: required settles, acceptable pauses, timeouts.
- Failure modes that look like something else — a rejected command that still
  reports success, a read that wedges the device, a member that persists across
  power cycles.
- What is **not** used, and why (destructive opcodes, rejected encodings,
  untested models).

Do not put product behaviour here: what Yunari chooses to show, its cadence
policy, and its renderer belong in [`../architecture.md`](../architecture.md)
and [`../product.md`](../product.md). Do not put a design decision here either:
those are change records in [`../decisions/`](../decisions/).

## Keeping a document true

Each document opens with a metadata block: family, models, **firmware verified**,
transport, driver and the date the hardware was last verified.

When a change teaches something new — a corrected opcode, a firmware difference,
a timing value that actually works, a new refusal mode:

1. **Edit the device document in the same change** as the code.
2. State the fact in the present tense and say how it was measured (a
   decompiled vendor function, a probe on the panel, a firmware reply).
3. Move a resolved item out of *Open questions*; delete a claim that was wrong
   rather than leaving both versions.
4. Update `Last hardware verification` only when the hardware was actually met.
5. Leave a guess in *Open questions* until hardware proves it. A plausible
   inference presented as a fact is worse than an admitted gap.

## Probing safely

- **One writer at a time.** Close the vendor app (L-Connect 3, CAM, the TURZX
  app) before opening the device; all three take exclusive ownership.
- **A cancelled transfer can be expensive.** On the Lian Li, a cancelled bulk
  OUT wedges the panel until it is replugged; prefer waiting out a timeout over
  cancelling.
- **Vendor binaries are the ground truth.** L-Connect 3's `lianli.slv3.dll` and
  CAM's `index.node` / `app.asar` can be decompiled or inspected; the decision
  notes record which binary and version a fact came from. A community driver is
  corroboration, not proof.
- **Measure on the glass.** A command that reports success is not a picture on
  the panel; a camera frame or a screenshot of the panel is the evidence.
