import type http from "node:http";
import { familyFor } from "../panels/panel-families.js";
import type { PanelManager } from "../panels/panel-manager.js";
import type { DisplayStore } from "../settings/displays.js";
import {
  type ThemeStore,
  ThemeTooLargeError,
  ThemeValidationError,
} from "../themes/store.js";
import { sendJson, sendText } from "./http.js";

export interface PanelPreviewInput {
  readonly response: http.ServerResponse;
  readonly rawId: string;
  readonly display: string | null;
  readonly clip: boolean;
  readonly themeStore: ThemeStore;
  readonly displays: DisplayStore | undefined;
  readonly panels: PanelManager;
}

/**
 * Answers `GET /api/themes/:id/panel-preview`: the stored theme rendered at a
 * panel's declared geometry through the panels' own browser.
 *
 * The caller has already checked the method, loopback access and the theme id;
 * every refusal here is named so an authoring tool can act on it.
 */
export async function servePanelPreview(
  input: PanelPreviewInput,
): Promise<void> {
  const { response, rawId, themeStore, displays, panels } = input;

  // `read` rather than `readEnvelope`: the preview must refuse a stored theme
  // that does not validate, and only `read` tells that apart from an absent one.
  let theme: Awaited<ReturnType<ThemeStore["read"]>>;
  try {
    theme = await themeStore.read(rawId);
  } catch (error) {
    if (error instanceof ThemeValidationError) {
      sendJson(response, 422, {
        error: `Theme "${rawId}" is stored but does not validate.`,
        issues: error.issues,
      });
      return;
    }
    if (error instanceof ThemeTooLargeError) {
      sendText(response, 413, error.message);
      return;
    }
    throw error;
  }
  if (theme === undefined) {
    sendText(response, 404, "Theme not found.");
    return;
  }

  const record =
    input.display === null ? undefined : await displays?.find(input.display);
  if (record === undefined) {
    sendText(response, 404, "No such display.");
    return;
  }
  if (record.kind !== "panel") {
    sendText(response, 409, "That display is not a panel.");
    return;
  }
  // A record whose ids no family claims, or one with no hardware half, is a
  // display this build cannot render. The manager refuses it too; naming it
  // here is what turns its 500 into a reason the caller can act on.
  const hardware = record.panel;
  if (
    hardware === undefined ||
    familyFor(hardware.vendorId, hardware.productId) === undefined
  ) {
    sendText(response, 409, "The host has no panel driver for that display.");
    return;
  }

  // The route is loopback-only, so the manager's own sentence is safe to relay.
  // It names why the capture failed; the generic 500 would not.
  let bytes: Uint8Array;
  try {
    bytes = await panels.capturePreview(record.id, rawId, input.clip);
  } catch (error) {
    console.error(error);
    sendText(
      response,
      500,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  response.writeHead(200, {
    "content-type": "image/png",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  response.end(Buffer.from(bytes));
}
