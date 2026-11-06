import type http from "node:http";
import type { DisplayPresentation } from "@yunari/renderer-core";
import type { ListenableServer } from "../cli/net.js";
import type { PanelControlCommand, PanelHint } from "../panels/panel-device.js";
import type { PanelFamilyRegistry } from "../panels/panel-families.js";
import {
  DisplaySettingError,
  normalizePresentation,
} from "../settings/display-presentation.js";
import type { DisplayPatch, DisplayRecord } from "../settings/displays.js";
import {
  LOCAL_DISPLAY_ID,
  MonitorAlreadyHeldError,
  mintedDisplayId,
  normalizeMonitor,
  normalizePanelIdentity,
  normalizePatch,
  PanelAlreadyHeldError,
  samePanel,
} from "../settings/displays.js";
import type { Monitor } from "../settings/monitors.js";
import { readBody, sendJson, sendText } from "./http.js";
import { displayFor, isLoopbackRemote, peerOf, tokenFor } from "./identity.js";
import type { HostServerOptions } from "./options.js";
import { isPortFailure, panelCommand, usbId } from "./panels.js";

export interface DisplayRouteDeps {
  readonly options: HostServerOptions;
  readonly monitors: () => Promise<readonly Monitor[]>;
  readonly panelsAttached: () => Promise<readonly PanelHint[]>;
  readonly panelFamilies: PanelFamilyRegistry;
  readonly server: ListenableServer;
}

/**
 * The host identity and display-record routes. Returns true when the request
 * was answered; an `/api/displays` subpath that names no route falls through to
 * the shared 405/static answer, exactly as the one block did.
 */
export function createDisplayRoutes(
  deps: DisplayRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const { options, monitors, panelsAttached, panelFamilies, server } = deps;
  const displays = options.displays;
  const hostRecord = options.host;

  return async function handleDisplayRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // **The one route an unpaired client may read**, and the reason a display
    // that has lost its host's address can find it again: a re-find sweep asks
    // every host on the network who it is and keeps the one whose id it stored.
    // So it answers before every gate below — the display guard in particular.
    // The name is one character from `/api/hosting`, the LAN on/off setting,
    // deliberately and not by accident (R24). A host with no identity is not
    // registered at all, for the reason the `host` option gives.
    //
    // **A paired display also reads its own token here.** That is what keeps a
    // re-find working after the cookie change: the cookie is HttpOnly and the
    // URL carries no token, so a newly paired display has no readable
    // credential — and a re-find reaches a *different origin*, where this
    // host's cookie is never sent. Storage is the only thing that crosses that
    // boundary, and the token is exactly what the display held before. Loopback
    // and unpaired callers are answered no token, because they hold none.
    if (
      hostRecord !== undefined &&
      url.pathname === "/api/host" &&
      request.method === "GET"
    ) {
      // **Cross-origin, and this route alone.** A sweep reaches hosts by their
      // LAN addresses, so every one of those reads is cross-origin and a browser
      // refuses it without this header. It is set on this response rather than in
      // `sendJson` on purpose: a shared writer that could turn CORS on is one
      // edit away from making every route in this file cross-origin readable,
      // and this route is meant to be the single deliberate exception (R25).
      // No `Access-Control-Allow-Credentials`: a sweep sends no credential, and
      // a wildcard origin with credentials is refused by browsers anyway — so a
      // foreign page can never present this display's cookie to read the token.
      response.setHeader("Access-Control-Allow-Origin", "*");

      // The port comes from the socket, never from an option or the binding: a
      // host that fell back to the next port must answer the port a display
      // actually has to dial. Null for a server that is not listening, the same
      // honest absence `/api/hosting` reports.
      const address = server.address();

      // Resolving the display authenticates the presented credential; the
      // request is then answered its own token and never another's. The touch
      // inside `displayFor` is a welcome sighting: this call is a load.
      const record = await displayFor(request, displays);
      const token = record === undefined ? undefined : tokenFor(request);

      sendJson(response, 200, {
        id: hostRecord.id,
        name: hostRecord.name,
        port:
          typeof address === "object" && address !== null ? address.port : null,
        ...(token === undefined ? {} : { token }),
      });
      return true;
    }

    // A display's own record, addressed by the id a rename never moves. Removing
    // one takes its credential with it — revoking *is* removing (ruling 12) —
    // which is why there is no second route that revokes.
    if (!url.pathname.startsWith("/api/displays")) return false;

    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      sendText(response, 403, "Displays are available on this PC only.");
      return true;
    }

    if (displays === undefined) {
      sendText(
        response,
        404,
        "Display management is not enabled on this host.",
      );
      return true;
    }

    // Before the id below, because neither is a reserved id: a display named
    // "Monitors" or "Autostart" legitimately mints one (`mintedDisplayId`), so
    // these routes have to be found before anything reads the segment as an id.
    if (url.pathname === "/api/displays/monitors" && request.method === "GET") {
      sendJson(response, 200, { monitors: await monitors() });
      return true;
    }

    // The host, not a monitor: one entry at sign-in covers every local display
    // including one added later. GET answers what the OS holds now, because a
    // toggle has to show its own state; POST turns that entry on or off and
    // answers with the registrar's own message, which is what the surface
    // shows.
    if (
      url.pathname === "/api/displays/autostart" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      const autostart = options.autostart;

      if (autostart === undefined) {
        sendText(
          response,
          404,
          "This host cannot register itself to start at sign-in.",
        );
        return true;
      }

      if (request.method === "GET") {
        sendJson(response, 200, { enabled: autostart.state() });
        return true;
      }

      let enabled: boolean;
      try {
        const parsed: unknown = JSON.parse(await readBody(request));
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed) ||
          typeof (parsed as { readonly enabled?: unknown }).enabled !==
            "boolean"
        ) {
          throw new Error("That is not a sign-in setting.");
        }
        enabled = (parsed as { readonly enabled: boolean }).enabled;
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      // A registration the OS refused is not a bad request: the outcome
      // travels with its own message either way.
      sendJson(response, 200, await autostart.set(enabled));
      return true;
    }

    // A local monitor: the host's own screen, so it is specified rather than
    // paired and has no credential to answer with.
    if (url.pathname === "/api/displays" && request.method === "POST") {
      let body: {
        readonly label: string;
        readonly monitor: unknown;
        readonly shape?: unknown;
        readonly rotation?: unknown;
      };

      try {
        const parsed: unknown = JSON.parse(await readBody(request));
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("That is not a display setting.");
        }
        body = parsed as {
          readonly label: string;
          readonly monitor: unknown;
          readonly shape?: unknown;
          readonly rotation?: unknown;
        };
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      // The hint's own rule, from the store that has to read it back: a record
      // the file would drop on the next read must not be written at all.
      const monitor = normalizeMonitor(body.monitor);

      if (monitor === undefined) {
        sendText(response, 400, "A local display needs the monitor it is on.");
        return true;
      }

      // The label's own rule, asked before the write: a name the store would
      // refuse is the caller's to fix, and the catch below keeps only the
      // store's failures, whose words name this machine's files.
      let presentation: DisplayPresentation;

      try {
        mintedDisplayId(body.label);
        presentation = normalizePresentation(body.shape, body.rotation);
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      let display: DisplayRecord;

      try {
        display = await displays.createLocal(body.label, monitor, presentation);
      } catch (error) {
        // A monitor a local display already holds is the request conflicting
        // with what this host holds, not a body the store would not read —
        // and it is a conflict rather than a success, because two records for
        // one screen would put two windows on it.
        if (error instanceof MonitorAlreadyHeldError) {
          sendText(response, 409, error.message);
          return true;
        }

        // Anything else came from the store's own file: the detail goes to
        // this host's console, and the caller is told only that it failed.
        console.error(error);
        sendText(response, 500, "The host could not add that display.");
        return true;
      }

      // The window is the host's own, so it opens one now: a display the owner
      // just added is the one case `lastSeenAt` cannot speak for.
      await options.launcher?.reconcile();

      sendJson(response, 201, { display: peerOf(display) });
      return true;
    }

    const match = url.pathname.match(/^\/api\/displays\/([^/]+)$/);
    const id = match === null ? undefined : decodeURIComponent(match[1] ?? "");

    if (id !== undefined && request.method === "PATCH") {
      let patch: DisplayPatch;

      try {
        const parsed: unknown = JSON.parse(await readBody(request));
        // A body that is not an object holds no patch, and reading a field
        // off one would be a TypeError rather than a refusal.
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("That is not a display setting.");
        }
        patch = parsed as DisplayPatch;
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      // The store's own rules, asked once for both fields: a patch it would
      // refuse is a 400 — the caller's typo, not a host fault, which is what
      // the wrapper's 500 would say — and a refused handler is an uncaught
      // exception in Node. The label rule is `normalizeLabel` and not the id
      // rule: the id was minted when the display was created, a rename mints
      // no other one, and a name the id rule would refuse is still a name.
      try {
        patch = normalizePatch(patch);
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      let updated: DisplayRecord | undefined;

      try {
        updated = await displays.update(id, patch);
      } catch (error) {
        // A patch that names both fields is decided against the final shape,
        // which only the record knows — and that refusal is the caller's, not
        // the host's. Anything else came from the store's own file.
        if (error instanceof DisplaySettingError) {
          sendText(response, 400, error.message);
          return true;
        }
        throw error;
      }

      if (updated === undefined) {
        sendText(response, 404, "No such display.");
        return true;
      }

      // A panel's clip is uploaded with the angle it was encoded for, so a
      // record that turned the glass re-uploads it; the page picks up the
      // angle for itself from its own poll. Only a changed clip restarts the
      // runner, which is the same comparison a theme save uses.
      try {
        await options.panels?.refreshVideo(id);
      } catch (error) {
        console.error(
          `Panel ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // A rendering mode is chosen when the device is opened, so the running
      // one is holding the old stream. The surface sends this field only when
      // the owner changed it, so a restart here is the toggle's own.
      if (patch.renderMode !== undefined) {
        try {
          await options.panels?.refresh(id);
        } catch (error) {
          console.error(
            `Panel ${id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // The answer is the record itself, so a surface redraws one row without
      // refetching the list it already has.
      sendJson(response, 200, peerOf(updated));
      return true;
    }

    if (id !== undefined && request.method === "DELETE") {
      // The Host is the display the host *is*, not a client anyone paired: it
      // has no credential to remove, and it is the one display that cannot be
      // re-paired if it goes.
      if (id === LOCAL_DISPLAY_ID) {
        sendText(response, 409, "The Host is not a paired client.");
        return true;
      }

      if (!(await displays.remove(id))) {
        sendText(response, 404, "No such display.");
        return true;
      }

      // The answers and the theme the display gave go with it: an id is minted
      // again by the next display of that name, and it must not inherit a
      // device or a theme its predecessor chose. Nothing is swept when a store
      // is absent, because nothing was ever written to it.
      await options.themeSettings?.removeDisplay(id);
      await options.activeTheme?.clear(id);

      // The window goes with the record, and only a window this host opened
      // is the host's to close. A panel is the same act one layer down: its
      // runner is stopped, because a record nothing points at is a panel
      // still showing a theme nobody assigned it.
      options.launcher?.close(id);
      // The answer waits for the release: a restart queued behind it would
      // otherwise claim a device the old runner has not let go. A panel that
      // cannot release its port — unplugged mid-stop — must not become an
      // unhandled rejection at the process level, so the failure is reported
      // and not answered; the record is gone either way.
      try {
        await options.panels?.stop(id);
      } catch (error) {
        console.error(
          `Panel ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      sendJson(response, 200, { ok: true });
      return true;
    }

    // The panels attached right now, for the owner to pick from. A panel is
    // found rather than admitted, so this is the same shape as `monitors`:
    // what the hardware says is here, and no record implied by it.
    if (url.pathname === "/api/displays/panels" && request.method === "GET") {
      if (options.panels === undefined) {
        sendText(
          response,
          404,
          "Panel management is not enabled on this host.",
        );
        return true;
      }

      // **`held` is answered here because this is where both lists are.** A
      // surface offering a panel that already has a record would be offering
      // a choice whose only outcome is the 409 below — and the client cannot
      // work it out, since the display map carries no hardware. An attached
      // panel stays in the list with `held` true rather than disappearing:
      // a device the owner can see is plugged in, and told is already added,
      // is a different fact from one they cannot see at all.
      //
      // The comparison is the store's own `samePanel`, not an equality on the
      // ids: that is the rule `createPanel` refuses by, and a surface that
      // used a different one would offer a device the write then rejects.
      const known = displays === undefined ? [] : await displays.list();

      sendJson(response, 200, {
        // One scan answers both questions: `held` is whether a record drives
        // this device, `heldId` is which record. A second lookup for the id
        // could disagree with the `held` beside it.
        panels: (await panelsAttached()).map((panel) => {
          const holder = known.find(
            (record) =>
              record.panel !== undefined && samePanel(record.panel, panel),
          );
          // The family table is what the support record and the command list
          // are read from, so a surface renders what this host can actually
          // do rather than a list the caller supplied. A device no row claims
          // keeps its hint and gets the honest empty command list.
          const family = panelFamilies.forDevice(
            panel.vendorId,
            panel.productId,
          );

          return {
            ...panel,
            held: holder !== undefined,
            ...(holder === undefined ? {} : { heldId: holder.id }),
            ...(family === undefined ? {} : { support: family.support }),
            commands: family?.commands ?? [],
          };
        }),
      });
      return true;
    }
    // A USB panel: driven by this host rather than served a page, so it is
    // specified like a local monitor and has no credential either.
    if (url.pathname === "/api/displays/panels" && request.method === "POST") {
      // Refused before the body is read: a host with no panel manager would
      // write a record nothing can drive, which is a row in the list that
      // never shows anything and cannot say why.
      if (options.panels === undefined) {
        sendText(
          response,
          404,
          "Panel management is not enabled on this host.",
        );
        return true;
      }

      let body: {
        readonly label: string;
        readonly panel: unknown;
        readonly shape?: unknown;
        readonly rotation?: unknown;
      };

      try {
        const parsed: unknown = JSON.parse(await readBody(request));
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("That is not a display setting.");
        }
        body = parsed as typeof body;
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      // The record's own rule, from the store that has to read it back. The
      // identity only: the model is the family table's answer, below.
      const panel = normalizePanelIdentity(body.panel);

      if (panel === undefined) {
        sendText(response, 400, "A panel display needs the device it drives.");
        return true;
      }

      // A model this host has no driver for is the caller's to fix, and it is
      // refused *before* the write: a record nothing can open would be a row
      // in the list that never shows anything and cannot say why.
      const family = panelFamilies.forDevice(panel.vendorId, panel.productId);

      if (family === undefined) {
        sendText(
          response,
          400,
          `No driver on this host claims ${usbId(panel.vendorId)}:${usbId(panel.productId)}.`,
        );
        return true;
      }

      // The record carries the model the family names, rather than whatever
      // the caller wrote: the table is the one owner of which model an id is,
      // and a record that disagreed with it would be a row nothing can open.
      const hardware = { ...panel, model: family.id };

      let presentation: DisplayPresentation;

      try {
        mintedDisplayId(body.label);
        presentation = normalizePresentation(body.shape, body.rotation);
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      let display: DisplayRecord;

      try {
        display = await displays.createPanel(
          body.label,
          hardware,
          presentation,
        );
      } catch (error) {
        if (error instanceof PanelAlreadyHeldError) {
          sendText(response, 409, error.message);
          return true;
        }

        console.error(error);
        sendText(response, 500, "The host could not add that display.");
        return true;
      }

      // The panel is driven now rather than on the next reconcile: a display
      // the owner just added is the one case a background pass cannot speak
      // for, because its first frame is the whole difference between a
      // configured panel and a black screen.
      await options.panels?.start(display.id);

      sendJson(response, 201, { display: peerOf(display) });
      return true;
    }

    // One hardware control aimed at a display's running device. The body is
    // refused before the manager is called: the adapter refuses the same
    // values, but by then the caller has already been answered a 500 for a
    // typo, which is the wrong side of the protocol.
    const commandMatch = url.pathname.match(
      /^\/api\/displays\/([^/]+)\/panel\/command$/,
    );
    const connectionMatch = url.pathname.match(
      /^\/api\/displays\/([^/]+)\/panel\/(reconnect|disconnect)$/,
    );

    if (commandMatch !== null && request.method === "POST") {
      if (options.panels === undefined) {
        sendText(
          response,
          404,
          "Panel management is not enabled on this host.",
        );
        return true;
      }

      const commandId = decodeURIComponent(commandMatch[1] ?? "");
      const display = await displays.find(commandId);

      if (display === undefined) {
        sendText(response, 404, "No such display.");
        return true;
      }

      // A panel record is what a control is for; a paired client or a local
      // monitor has no device behind it and no command to send.
      if (display.kind !== "panel") {
        sendText(response, 400, "That display is not a panel.");
        return true;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(await readBody(request));
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      let command: PanelControlCommand;

      try {
        command = panelCommand(parsed);
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      let reply: string;

      try {
        reply = await options.panels.command(commandId, command);
      } catch (error) {
        // A runner that is stopping, or a port that failed mid-write, has no
        // device to send to now: the command conflicts with what the host is
        // doing rather than being the host's fault. Anything else is a real
        // failure and keeps its message.
        if (isPortFailure(error)) {
          sendText(
            response,
            409,
            error instanceof Error ? error.message : String(error),
          );
          return true;
        }

        sendText(
          response,
          500,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      sendJson(response, 200, { ok: true, reply });
      return true;
    }

    // The manual connection controls: a reconnect closes what this host holds
    // and opens the device again; a disconnect closes it and keeps it closed
    // until a later reconnect or start. A panel the retry loop is already
    // reopening joins the same per-display chain, so the two cannot open the
    // port twice.
    if (connectionMatch !== null && request.method === "POST") {
      if (options.panels === undefined) {
        sendText(
          response,
          404,
          "Panel management is not enabled on this host.",
        );
        return true;
      }

      const connectionId = decodeURIComponent(connectionMatch[1] ?? "");
      const display = await displays.find(connectionId);

      if (display === undefined) {
        sendText(response, 404, "No such display.");
        return true;
      }

      if (display.kind !== "panel") {
        sendText(response, 400, "That display is not a panel.");
        return true;
      }

      try {
        if (connectionMatch[2] === "disconnect") {
          await options.panels.disconnect(connectionId);
        } else {
          await options.panels.reconnect(connectionId);
        }
      } catch (error) {
        if (isPortFailure(error)) {
          sendText(
            response,
            409,
            error instanceof Error ? error.message : String(error),
          );
          return true;
        }

        sendText(
          response,
          500,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      sendJson(response, 200, {
        ok: true,
        status: options.panels.status(connectionId),
      });
      return true;
    }

    // Named by the path it answered rather than by the block: a caller told
    // that GET is supported on a path without it is told nothing true.
    const supported =
      url.pathname === "/api/displays/monitors"
        ? "GET"
        : url.pathname === "/api/displays/autostart"
          ? "GET and POST"
          : url.pathname === "/api/displays/panels"
            ? "GET and POST"
            : url.pathname === "/api/displays"
              ? "POST"
              : commandMatch !== null || connectionMatch !== null
                ? "POST"
                : id === undefined
                  ? undefined
                  : "PATCH and DELETE";

    if (supported !== undefined) {
      sendText(response, 405, `This path supports ${supported}.`);
      return true;
    }

    // A path that is no route of its own — `/api/displays/` or
    // `/api/displays/a/b` — has no method set to state: both routes that need
    // an id need one this path does not carry. It falls through to the answer
    // every unknown path gets rather than asserting methods for it.
    return false;
  };
}
