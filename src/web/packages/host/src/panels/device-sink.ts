/**
 * What Yunari owns beyond a panel's picture.
 *
 * A **device sink** is one physical device this host drives: the panel it
 * paints, the lighting it can write, and the hardware controls it accepts.
 * `PanelDevice.sink` is the one attachment point, so a driver declares the
 * device once and every consumer — the descriptor route, the SignalRGB
 * receiver — reads the same object. It is not a second registry: the panel
 * manager still owns opening, one instance per display.
 *
 * A sink never opens hardware. Its writers are the opened driver's own methods,
 * so they share the handle and the write queue the panel already uses.
 */

/** How LEDs are arranged on a device, for a consumer turning them into
 *  positions. `ring` is the perimeter of `width`×`height`; `strip` is
 *  `width` LEDs per row across `height` rows; `rings` is `count` rings of
 *  `width`×`height`, laid left to right one cell apart. */
export interface LightingLayout {
  readonly shape: "ring" | "strip" | "rings";
  readonly width: number;
  readonly height: number;
  /** How many rings `shape: "rings"` draws. Absent for the other shapes. */
  readonly count?: number;
}

/** One independently addressable run of LEDs on a device. */
export interface LightingChannel {
  readonly name: string;
  readonly leds: number;
}

/** What a device's lighting physically is: the counts a consumer needs before
 *  it sends a frame. The writer itself is {@link DeviceSink.writeColors}. */
export interface DeviceLighting {
  readonly ledCount: number;
  readonly channels: readonly LightingChannel[];
  readonly layout: LightingLayout;
}

/** One reading from a device's own status report. Every field is measured;
 *  a device that does not report one must not fabricate it. */
export interface DeviceTelemetry {
  readonly liquidTempC: number;
  readonly pumpRpm: number;
  readonly fanRpm: number;
  readonly pumpPercent: number;
  readonly fanPercent: number;
}

/** The controls a device accepts and the readings it can answer. */
export interface DeviceControls {
  readonly pump: boolean;
  readonly fans: boolean;
  readonly telemetry: boolean;
  /** Writes the requested percentages. The driver owns the device's own
   *  limits (a pump with a 25% floor clamps there); omitted fields are left
   *  alone. */
  set(input: {
    readonly pumpPercent?: number | undefined;
    readonly fanPercent?: number | undefined;
  }): Promise<void>;
  /** Reads the device's status report now. */
  read(): Promise<DeviceTelemetry>;
}

/** What a lighting consumer asks the device to show. */
export type LightingMode = "canvas" | "forced" | "off";

/**
 * One device as every surface sees it.
 *
 * `id` is stable across restarts and is what a consumer keys saved layout by.
 * `lighting` is absent when the device has no LEDs, `controls` when it accepts
 * none, and `display` when it paints nothing.
 */
export interface DeviceSink {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly lighting?: DeviceLighting | undefined;
  readonly controls?: DeviceControls | undefined;
  readonly display?:
    | {
        readonly kind: "panel";
        readonly width: number;
        readonly height: number;
      }
    | undefined;
  /** Writes one frame: RGB triples, one per LED, in channel order. The driver
   *  converts to whatever order its wire uses and serialises with every other
   *  write on the device. */
  writeColors(rgb: Uint8Array): Promise<void>;
}

/**
 * The device order every consumer shares.
 *
 * The descriptor's `devices` array defines the UDP device index, so it must not
 * depend on which panel happened to open first: the manager's entries are
 * insertion-ordered and a reconnect re-adds one. Sorting by the stable id is
 * the rule, and it lives here so the route and the receiver cannot disagree.
 */
export function orderedSinks(
  sinks: readonly DeviceSink[],
): readonly DeviceSink[] {
  return [...sinks].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
}
