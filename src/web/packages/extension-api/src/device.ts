import type { PluginManifest } from "./manifest";

/** The buses a panel family can declare. Serial is the only transport whose
 *  address is a path rather than a vendor/product pair. */
export type PanelTransport = "usb" | "hid" | "serial";

export const PANEL_TRANSPORTS: ReadonlySet<PanelTransport> = new Set([
  "usb",
  "hid",
  "serial",
]);

/** One device a plugin asks the host to reach. Serial carries the declared
 *  path as its address; the ids are what the family declares. */
export type DeviceAllowlist =
  | {
      readonly transport: "usb" | "hid";
      readonly vendorId: number;
      readonly productId: number;
      readonly interfaceNumber?: number;
    }
  | {
      readonly transport: "serial";
      readonly path: string;
      readonly vendorId?: number;
      readonly productId?: number;
    };

/** Canonical panel command union; `PanelControlCommand` in the host aliases it. */
export type PanelCommand =
  | { readonly kind: "brightness"; readonly level: number }
  | { readonly kind: "screen"; readonly on: boolean }
  | {
      readonly kind: "panel-settings";
      /** What the panel shows when it powers on: 0 default, 1 image, 2 video. */
      readonly startMode: 0 | 1 | 2;
      /** One byte; the adapter sends the image upside down when true. */
      readonly flip: boolean;
      /** Whole steps: 0 is no sleep, 1..10 are the firmware's own. */
      readonly sleepDelay: number;
    }
  | { readonly kind: "restart" }
  | { readonly kind: "status" }
  | { readonly kind: "hello" };

/** Membership for the manifest's declared command list. The annotation makes
 *  the compiler reject a kind the union does not carry. */
export const PANEL_COMMAND_KINDS: ReadonlySet<PanelCommand["kind"]> = new Set([
  "brightness",
  "screen",
  "panel-settings",
  "restart",
  "status",
  "hello",
]);

/** A serial path is a Windows COM port or an absolute POSIX path. A relative
 *  path, a drive letter or a backslash is refused: the host opens exactly what
 *  the user consented to, and a shape with an ambiguous root is not that. */
const WINDOWS_COM_PORT = /^com\d+$/i;

export function isSerialPath(value: string): boolean {
  if (WINDOWS_COM_PORT.test(value)) return true;
  if (!value.startsWith("/") || value.includes("\\")) return false;
  return !value.split("/").includes("..");
}

function hexId(value: number): string {
  return value.toString(16).padStart(4, "0");
}

/** The consent row's stable name. Vendor and product hex are lowercase and
 *  four digits wide, so one device has one identity. */
export function deviceIdentity(device: DeviceAllowlist): string {
  if (device.transport === "serial") return `serial:${device.path}`;
  return `${device.transport}:${hexId(device.vendorId)}:${hexId(device.productId)}`;
}

/** Every device the manifest asks the host to reach, in declaration order.
 *  A duplicate identity is one consent row, because consent is per device. */
export function deviceAllowlistOf(
  manifest: PluginManifest,
): readonly DeviceAllowlist[] {
  const devices: DeviceAllowlist[] = [];
  const seen = new Set<string>();
  const add = (device: DeviceAllowlist): void => {
    const identity = deviceIdentity(device);
    if (seen.has(identity)) return;
    seen.add(identity);
    devices.push(device);
  };
  for (const family of manifest.contributes.panelFamilies ?? []) {
    for (const transport of family.transports) {
      if (transport === "serial") {
        // Admission refuses a serial family without a path; a hand-built
        // manifest has none to name, so it declares no device.
        if (family.serialPath === undefined) continue;
        add({
          transport: "serial",
          path: family.serialPath,
          vendorId: family.vendorId,
          productId: family.productId,
        });
        continue;
      }
      add({
        transport,
        vendorId: family.vendorId,
        productId: family.productId,
      });
    }
  }
  return devices;
}

/** What a panel presents to the host: one raster frame in the encoding the
 *  family states. */
export interface PanelPresentParams {
  readonly format: "jpeg" | "png";
  readonly bytes: Uint8Array;
}

export interface PanelOpenParams {
  readonly width: number;
  readonly height: number;
  readonly renderMode?: string;
}

export interface PanelCommandParams {
  readonly command: PanelCommand;
}
