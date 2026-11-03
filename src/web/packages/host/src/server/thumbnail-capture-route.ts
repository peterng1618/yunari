import type http from "node:http";
import type { PanelManager } from "../panels/panel-manager.js";
import { isValidThemeId, type ThemeStore } from "../themes/store.js";
import {
  type ThumbnailStore,
  thumbnailCaptureSize,
} from "../themes/thumbnails.js";
import { isPlatformError, sendJson, sendText } from "./http.js";

export interface ThumbnailCaptureInput {
  readonly response: http.ServerResponse;
  readonly rawId: string;
  readonly themeStore: ThemeStore;
  readonly thumbnails: ThumbnailStore | undefined;
  readonly panels: PanelManager | undefined;
}

/**
 * Answers `POST /api/themes/:id/thumbnail/capture`: the theme's player page
 * photographed at the library's own size through the panels' shared browser.
 *
 * The caller has already checked the method, loopback access and the theme id;
 * an existing picture is the editor's finer capture and is never replaced.
 */
export async function serveThumbnailCapture(
  input: ThumbnailCaptureInput,
): Promise<void> {
  const { response, rawId, themeStore, thumbnails, panels } = input;

  if (thumbnails === undefined || !isValidThemeId(rawId)) {
    sendText(response, 400, "Invalid theme id.");
    return;
  }

  if (panels === undefined) {
    sendText(response, 503, "This host drives no panels.");
    return;
  }

  if (await thumbnails.has(rawId)) {
    sendJson(response, 200, {
      ok: true,
      captured: false,
      reason: "This theme already has a thumbnail.",
    });
    return;
  }

  const envelope = await themeStore.readEnvelope(rawId);
  if (envelope === undefined) {
    sendText(response, 404, "Theme not found.");
    return;
  }

  const geometry = thumbnailCaptureSize(envelope.artboard);
  let png: Uint8Array;

  try {
    png = await panels.captureTheme(rawId, geometry);
  } catch (error) {
    console.error(error);
    sendText(
      response,
      503,
      error instanceof Error
        ? error.message
        : "The host could not render a thumbnail.",
    );
    return;
  }

  try {
    await thumbnails.write(rawId, png);
  } catch (error) {
    // A PNG the store would not read is the renderer's; a write it could not
    // perform is this machine's, and its path stays off the wire.
    if (isPlatformError(error)) {
      console.error(error);
      sendText(response, 500, "That thumbnail could not be saved.");
      return;
    }
    sendText(
      response,
      400,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  sendJson(response, 200, {
    ok: true,
    captured: true,
    width: geometry.width,
    height: geometry.height,
  });
}
