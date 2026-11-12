import type http from "node:http";
import type { PanelHint } from "../panels/panel-device.js";
import { type DisplayRecord, samePanel } from "../settings/displays.js";
import { sendJson, sendText } from "./http.js";

export interface PanelResetInput {
  readonly response: http.ServerResponse;
  /** The panel record the caller already found. */
  readonly display: DisplayRecord;
  /** The panels attached right now: the only source of the device's OS id. */
  readonly attached: () => Promise<readonly PanelHint[]>;
  /** The privileged action; the real one prompts for elevation. */
  readonly reset: (deviceId: string) => Promise<void>;
}

/**
 * Answers `POST /api/displays/:id/panel/reset-device`: Windows restarts the USB
 * node the display's panel hangs off.
 *
 * The caller has already checked the record exists and is a panel. **The OS
 * instance id is resolved here, from the listing, never taken from the
 * request**: the action is a privileged call, and the caller only proves which
 * record it means. A panel that is not attached, or that the host cannot name,
 * is a conflict rather than a failed action — no restart could have run.
 */
export async function resetDisplayPanel(input: PanelResetInput): Promise<void> {
  const { response, display } = input;

  const identity = display.panel;
  if (identity === undefined) {
    sendText(response, 400, "That display has no panel device.");
    return;
  }

  const attached = (await input.attached()).find((hint) =>
    samePanel(identity, hint),
  );

  if (attached === undefined) {
    sendText(response, 409, "That panel is not attached to this PC.");
    return;
  }

  if (attached.deviceId === undefined) {
    sendText(
      response,
      409,
      "This host cannot name that panel's USB device, so it cannot restart it.",
    );
    return;
  }

  try {
    await input.reset(attached.deviceId);
  } catch (error) {
    // The refusal is the whole answer: a declined prompt or a USB error is
    // what the owner has to act on, and a generic sentence would hide it.
    sendText(
      response,
      500,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  sendJson(response, 200, { ok: true });
}
