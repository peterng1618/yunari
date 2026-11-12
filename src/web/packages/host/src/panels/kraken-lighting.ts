import type { DeviceSink, DeviceTelemetry } from "./device-sink.js";

/**
 * The Kraken Z's lighting and fan reports, taken from SignalRGB's shipped
 * `Nzxt_Kraken_Z3_AIO.js` (verified 2026-11-12, firmware 5.11.0).
 *
 * **Interface 1 takes these as 64-byte HID reports**, the same control channel
 * the LCD commands use. That shared transport is why every writer here goes
 * through `KrakenPanel`'s one queue rather than writing the handle directly.
 *
 * **The LED payload is GRB.** The plugin calls
 * `getColors("Inline", "GRB")`, so the wire wants green before red even though
 * the UDP contract carries RGB triples; the conversion belongs here, at the
 * device boundary.
 */

/** One channel of 40 LEDs. */
export const KRAKEN_LED_COUNT = 40;

/** The pump's firmware floor: a lower requested value is raised to it. */
const PUMP_MINIMUM_PERCENT = 25;
/** One report carries 60 colour bytes: 20 LEDs. */
const LEDS_PER_REPORT = 20;
/** The bytes one 40-LED frame occupies: 120 RGB components. */
const FRAME_COMPONENTS = KRAKEN_LED_COUNT * 3;

/** A whole percent from 0 to 100. Refuses a value no byte can represent
 *  rather than writing a fraction the caller did not ask for. */
export function wholePercent(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("A fan or pump percent must be a finite number.");
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

/** The pump's report level: the requested whole percent, but never below the
 *  firmware's 25% floor. */
export function pumpPercent(value: number): number {
  return Math.max(PUMP_MINIMUM_PERCENT, wholePercent(value));
}

/** The fan report level; fans may stop (0%). */
export function fanPercent(value: number): number {
  return wholePercent(value);
}

/** The two `22 10` / `22 11` data reports for one frame of RGB triples. */
export function lightingReports(rgb: Uint8Array): number[][] {
  if (rgb.length !== FRAME_COMPONENTS) {
    throw new Error(
      `A Kraken lighting frame is ${FRAME_COMPONENTS} RGB bytes; received ${rgb.length}.`,
    );
  }

  const reports: number[][] = [];

  for (let packet = 0; packet < 2; packet += 1) {
    const report = [0x22, 0x10 | packet, 0x01, 0x00];
    const first = packet * LEDS_PER_REPORT;

    for (let led = first; led < first + LEDS_PER_REPORT; led += 1) {
      const at = led * 3;
      // GRB: the device's channel order, not the frame's.
      report.push(rgb[at + 1] ?? 0, rgb[at] ?? 0, rgb[at + 2] ?? 0);
    }

    reports.push(report);
  }

  return reports;
}

/** The `22 A0` commit that shows the data written by the two reports. */
export function lightingCommit(): number[] {
  return [
    0x22, 0xa0, 0x01, 0x00, 0x01, 0x00, 0x00, 0x28, 0x00, 0x00, 0x80, 0x00,
    0x32, 0x00, 0x00, 0x01,
  ];
}

/** `72 01`: the pump's 40 fan-slot percentages. */
export function pumpReport(percent: number): number[] {
  return fanReportOf(0x01, pumpPercent(percent));
}

/** `72 02`: the fan's 40 percentages. */
export function fanReport(percent: number): number[] {
  return fanReportOf(0x02, fanPercent(percent));
}

function fanReportOf(command: number, level: number): number[] {
  const report = [0x72, command, 0x00, 0x00];
  for (let slot = 0; slot < 40; slot += 1) report.push(level);
  return report;
}

/** The fields of a `75 01` status reply, in the shipped plugin's offsets:
 *  liquid temperature at 15 (whole °C) and 16 (tenths), pump RPM 18:17,
 *  pump percent 19, fan RPM 24:23, fan percent 25. */
export function parseKrakenStatus(report: Uint8Array): DeviceTelemetry {
  if (report.length < 26) {
    throw new Error(
      `A Kraken status reply is at least 26 bytes; received ${report.length}.`,
    );
  }

  return {
    liquidTempC: (report[15] ?? 0) + (report[16] ?? 0) / 10,
    pumpRpm: ((report[18] ?? 0) << 8) | (report[17] ?? 0),
    pumpPercent: report[19] ?? 0,
    fanRpm: ((report[24] ?? 0) << 8) | (report[23] ?? 0),
    fanPercent: report[25] ?? 0,
  };
}

/**
 * The driver-side pieces the sink writes through.
 *
 * They are closures over the **already-open** panel: `exclusive` is that
 * panel's one write queue and `write`/`readUntil` are its HID handle and reply
 * matching. The sink never opens anything, which is what makes lighting, fans
 * and the LCD one owner.
 */
export interface KrakenSinkDeps {
  readonly size: number;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  write(report: number[]): void;
  readUntil(
    first: number,
    second: number,
  ): { readonly report: Uint8Array } | undefined;
}

/** The Kraken as a device sink: one LED channel, pump/fans and status. */
export function createKrakenSink(deps: KrakenSinkDeps): DeviceSink {
  return {
    id: "kraken-z",
    kind: "kraken",
    name: "NZXT Kraken Z",
    lighting: {
      ledCount: KRAKEN_LED_COUNT,
      channels: [{ name: "Kraken Z", leds: KRAKEN_LED_COUNT }],
      // Three AER RGB fans are daisy-chained to the pump's 40-LED channel, each
      // a ring of 8 LEDs (24 lit; the remaining 16 slots stay empty and black).
      layout: { shape: "rings", width: 3, height: 3, count: 3 },
    },
    controls: {
      pump: true,
      fans: true,
      telemetry: true,
      set: async (input) => {
        // The reports are packed and clamped before the queue is joined, so a
        // bad value cannot leave half a request on the wire.
        const pump =
          input.pumpPercent === undefined
            ? undefined
            : pumpReport(input.pumpPercent);
        const fan =
          input.fanPercent === undefined
            ? undefined
            : fanReport(input.fanPercent);

        if (pump === undefined && fan === undefined) {
          throw new Error(
            "A controls request needs pumpPercent or fanPercent.",
          );
        }

        await deps.exclusive(async () => {
          if (pump !== undefined) deps.write(pump);
          if (fan !== undefined) deps.write(fan);
        });
      },
      read: async () =>
        await deps.exclusive(async () => {
          deps.write([0x74, 0x01]);
          const reply = deps.readUntil(0x75, 0x01);
          if (reply === undefined) {
            throw new Error("The Kraken did not answer its status query.");
          }

          return parseKrakenStatus(reply.report);
        }),
    },
    display: { kind: "panel", width: deps.size, height: deps.size },
    writeColors: async (rgb) => {
      // Validate and pack first: a caller's short frame is refused before it
      // can join the queue.
      const reports = lightingReports(rgb);
      await deps.exclusive(async () => {
        for (const report of reports) deps.write(report);
        deps.write(lightingCommit());
      });
    },
  };
}
