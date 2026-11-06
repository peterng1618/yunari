/** The capability vocabulary is closed: a manifest naming anything else is
 *  refused, not ignored. Each description is what a consent surface shows the
 *  user, so it states the grant rather than the method that uses it. */
export type Capability =
  | "sensor:provide"
  | "asset:provide"
  | "panel:drive"
  | "network:fetch"
  | "storage:own"
  | "secrets:own"
  | "settings:own"
  | "ui:frame"
  | "usb:device"
  | "serial:device";

export const CAPABILITY_DESCRIPTIONS: Readonly<Record<Capability, string>> = {
  "sensor:provide": "Register a sensor provider.",
  "asset:provide": "Register an asset source or category.",
  "panel:drive": "Register a USB panel family and drive its device.",
  "network:fetch": "Make host-mediated requests to declared hosts.",
  "storage:own": "Keep a storage directory scoped to this plugin.",
  "secrets:own": "Keep encrypted secrets scoped to this plugin.",
  "settings:own": "Own settings for this plugin.",
  "ui:frame": "Render a contribution inside a sandboxed frame.",
  "usb:device": "Ask the host for USB transfers on declared device ids.",
  "serial:device": "Ask the host for serial transfers on declared paths.",
};

/** Membership is asked of this set, so the closed list has one derivation. */
export const CAPABILITIES: ReadonlySet<Capability> = new Set(
  Object.keys(CAPABILITY_DESCRIPTIONS) as Capability[],
);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && CAPABILITIES.has(value as Capability);
}
