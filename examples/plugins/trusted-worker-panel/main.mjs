/**
 * A panel family in the trusted-worker profile.
 *
 * The host asks the worker to open the device, to present frames and to run a
 * control command. The USB handle never leaves the host: `usb.open` returns a
 * token, and every later transfer names it.
 *
 * The ids below are placeholders, so no real panel answers. Replace the vendor
 * and product ids with the device you are driving, and replace `present` with
 * the byte layout its protocol documents.
 */

const VENDOR_ID = 4660; // 0x1234
const PRODUCT_ID = 22136; // 0x5678
const INTERFACE = 0;
const ENDPOINT = 1;

let api;
let token;

export function setHostApi(value) {
  api = value;
}

function host() {
  if (api === undefined) throw new Error("The host API is not ready.");
  return api;
}

function openToken() {
  if (token === undefined) throw new Error("The panel is not open.");
  return token;
}

/** Panels of this family attached right now. `[]` is a true answer: these
 *  placeholder ids are not on this machine. */
export function attached() {
  return [];
}

/** `{width, height, renderMode}`; the reply states the cadence and encoding. */
export async function open() {
  if (token !== undefined) throw new Error("This worker already has a panel open.");

  token = await host().call("usb.open", {
    transport: "usb",
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    // The consented interface is part of the device's identity; leaving it out
    // asks the host for a different device than the one the user approved.
    interfaceNumber: INTERFACE,
  });

  return { frameIntervalMs: 1000, stillFormat: "jpeg" };
}

/** `{format, bytes}`; one raster frame per call. */
export async function present(params) {
  await host().call("usb.bulkTransfer", {
    token: openToken(),
    endpoint: ENDPOINT,
    bytes: params.bytes,
  });
}

/** `{command}`; the reply is a short sentence or "". */
export function command(params) {
  switch (params?.command?.kind) {
    case "hello":
      return "Example panel";
    case "brightness":
    case "screen":
      // This placeholder protocol has no brightness or power opcode yet. An
      // empty answer says "accepted, nothing to report" without pretending
      // the panel changed.
      return "";
    default:
      return "";
  }
}

export async function close() {
  const current = token;
  token = undefined;
  if (current !== undefined) await host().call("usb.close", { token: current });
  return null;
}

export {
  attached as "panel.attached",
  open as "panel.open",
  present as "panel.present",
  command as "panel.command",
  close as "panel.close",
};
