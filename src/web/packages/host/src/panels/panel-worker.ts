import { parentPort } from "node:worker_threads";
import type { PanelDevice } from "./panel-device.js";
import { BUILTIN_PANEL_FAMILIES } from "./panel-families.js";
import {
  connectDevtools,
  createPageRasterizer,
  type Devtools,
  type Rasterizer,
} from "./panel-raster.js";
import type {
  WorkerOpened,
  WorkerRequest,
  WorkerSinkDescriptor,
} from "./panel-worker-protocol.js";

/**
 * One panel's device and page rasteriser, on their own thread.
 *
 * **The host's loop stays free.** `node-hid`'s control transfers wait
 * synchronously, and a paletted frame is a PNG decode and a quantisation before
 * the six commands that put it on the glass; run here, the same work no longer
 * delays another panel's frame, the sample tick, or the editor's requests. The
 * measurements and the decision are `docs/decisions/0136`.
 *
 * The thread opens exactly one device. Its handle, its write queue and its
 * rasteriser never leave this file, and every message is a plain request that
 * names the work — the same members `panel-device.ts` declares.
 */

const port = parentPort;
if (port === null) {
  throw new Error("panel-worker must run on a worker thread.");
}

let device: PanelDevice | undefined;
let rasterizer: Rasterizer | undefined;

const answer = (id: number, value?: unknown): void => {
  port.postMessage({ id, ok: true, ...(value === undefined ? {} : { value }) });
};

const opened = (panel: PanelDevice): WorkerOpened => {
  const sink = panel.sink;

  return {
    geometry: panel.geometry,
    hasVideo: panel.video !== undefined,
    commands: panel.controls?.commands ?? [],
    ...(panel.stillFormat === undefined
      ? {}
      : { stillFormat: panel.stillFormat }),
    ...(panel.frameIntervalMs === undefined
      ? {}
      : { frameIntervalMs: panel.frameIntervalMs }),
    ...(sink === undefined ? {} : { sink: descriptorOf(sink) }),
  };
};

function descriptorOf(
  sink: NonNullable<PanelDevice["sink"]>,
): WorkerSinkDescriptor {
  return {
    id: sink.id,
    kind: sink.kind,
    name: sink.name,
    ...(sink.lighting === undefined ? {} : { lighting: sink.lighting }),
    ...(sink.controls === undefined
      ? {}
      : {
          controls: {
            pump: sink.controls.pump,
            fans: sink.controls.fans,
            telemetry: sink.controls.telemetry,
          },
        }),
    ...(sink.display === undefined ? {} : { display: sink.display }),
  };
}

function requireDevice(): PanelDevice {
  if (device === undefined) {
    throw new Error("this panel worker has no open device.");
  }

  return device;
}

function requireSink(): NonNullable<PanelDevice["sink"]> {
  const sink = requireDevice().sink;
  if (sink === undefined) {
    throw new Error("this panel states no sink.");
  }

  return sink;
}

function requireVideo(): NonNullable<PanelDevice["video"]> {
  const video = requireDevice().video;
  if (video === undefined) {
    throw new Error("this panel takes no video.");
  }

  return video;
}

function requireRasterizer(): Rasterizer {
  if (rasterizer === undefined) {
    throw new Error("this panel has no page.");
  }

  return rasterizer;
}

/** Points this thread's rasteriser at the host-opened page. */
async function attach(pageUrl: string, url: string): Promise<void> {
  if (rasterizer !== undefined) {
    throw new Error("this panel already has a page.");
  }

  const panel = requireDevice();
  const devtools: Devtools = await connectDevtools(pageUrl);

  try {
    // The host's raster browser owns the target and closes it when the runner
    // releases the rasteriser; this thread owns only the page's socket.
    rasterizer = await createPageRasterizer(
      devtools,
      {
        url,
        geometry: panel.geometry,
        ...(panel.stillFormat === undefined
          ? {}
          : { stillFormat: panel.stillFormat }),
      },
      async () => {},
    );
  } catch (error) {
    devtools.close();
    throw error;
  }
}

async function handle(request: WorkerRequest): Promise<void> {
  switch (request.kind) {
    case "open": {
      if (device !== undefined) {
        throw new Error("this panel already has a device.");
      }

      const family = BUILTIN_PANEL_FAMILIES.find(
        (row) =>
          row.vendorId === request.vendorId &&
          row.productId === request.productId,
      );
      if (family === undefined) {
        throw new Error(
          `No built-in panel driver claims ${hex(request.vendorId)}:${hex(request.productId)}.`,
        );
      }

      device = await family.open(request.open);
      answer(request.id, opened(device));
      return;
    }

    case "attach":
      await attach(request.pageUrl, request.url);
      answer(request.id);
      return;

    case "present":
      await requireDevice().present(request.still);
      answer(request.id);
      return;

    case "video-start":
      await requireVideo().start(
        request.bytes,
        request.placement,
        request.rotation,
      );
      answer(request.id);
      return;

    case "video-overlay":
      answer(request.id, await requireVideo().presentOverlay(request.png));
      return;

    case "video-stop":
      await requireVideo().stop();
      answer(request.id);
      return;

    case "command":
      answer(request.id, await requireControls().run(request.command));
      return;

    case "colors":
      await requireSink().writeColors(request.rgb);
      answer(request.id);
      return;

    case "set-controls":
      await requireSink().controls?.set(request.input);
      answer(request.id);
      return;

    case "read-controls": {
      const controls = requireSink().controls;
      if (controls === undefined) {
        throw new Error("this panel accepts no controls.");
      }
      answer(request.id, await controls.read());
      return;
    }

    case "capture":
      answer(
        request.id,
        request.overlay
          ? await requireRasterizer().captureOverlay()
          : await requireRasterizer().capture(),
      );
      return;

    case "close-raster": {
      const page = rasterizer;
      rasterizer = undefined;
      await page?.close();
      answer(request.id);
      return;
    }

    case "close": {
      const panel = device;
      device = undefined;
      const page = rasterizer;
      rasterizer = undefined;

      // Every release is attempted, as the runner's own stop does: the first
      // failure is still the answer, and a page left open is a target the host
      // cannot reclaim.
      let failure: unknown;

      if (page !== undefined) {
        try {
          await page.close();
        } catch (error) {
          failure = error;
        }
      }

      try {
        await panel?.close();
      } catch (error) {
        failure ??= error;
      }

      if (failure !== undefined) throw failure;
      answer(request.id);
      return;
    }

    default: {
      const unreachable: never = request;
      throw new Error(`the panel worker got ${String(unreachable)}`);
    }
  }
}

function requireControls(): NonNullable<PanelDevice["controls"]> {
  const controls = requireDevice().controls;
  if (controls === undefined) {
    throw new Error("this panel accepts no commands.");
  }

  return controls;
}

port.on("message", (request: WorkerRequest) => {
  void handle(request).catch((error: unknown) => {
    port.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

function hex(value: number): string {
  return value.toString(16).padStart(4, "0");
}
