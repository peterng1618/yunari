import type http from "node:http";
import {
  createBatch,
  formatSseEvent,
  SAMPLE_EVENT,
} from "@yunari/renderer-core";
import type { DeviceAssignment } from "../providers/lhm-mapping.js";
import {
  type DisplayAsk,
  groupByAsk,
  ProviderRegistry,
  unionOfKeys,
} from "../providers/registry.js";
import {
  type DeviceSettingsStore,
  EMPTY_DEVICE_SETTINGS,
} from "../settings/devices.js";
import type { DisplayStore } from "../settings/displays.js";
import { SseConnection } from "../transport/sse.js";
import { sendText } from "./http.js";
import { displayKeyFor, streamLanguage } from "./identity.js";
import {
  MAX_STREAM_CONNECTIONS,
  MAX_STREAM_CONNECTIONS_PER_DISPLAY,
  MAX_STREAM_KEY_BYTES,
  MAX_STREAM_KEYS,
} from "./limits.js";

/** The Host's device settings, as the store hands them to a tick. */
export type StoredDeviceSettings = Awaited<
  ReturnType<DeviceSettingsStore["read"]>
>;

export interface StreamingDeps {
  readonly registry: ProviderRegistry;
  readonly now: () => number;
  readonly intervalMs: number;
  readonly devices: DeviceSettingsStore | undefined;
  readonly displays: DisplayStore | undefined;
  readonly currentAssignment: (
    display: string,
    stored: StoredDeviceSettings,
  ) => Promise<DeviceAssignment>;
}

export interface StreamingOwner {
  readonly connections: Set<SseConnection>;
  openStream(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<void>;
  lastUnmapped(): readonly string[];
  stop(): void;
}

/**
 * The live side of the host: the SSE stream's lifecycle, its connection caps,
 * and the tick that samples every display's assignment.
 */
export function createStreaming(deps: StreamingDeps): StreamingOwner {
  const { registry, now, intervalMs, devices, currentAssignment } = deps;
  const displays = deps.displays;
  const connections = new Set<SseConnection>();
  /** Keys no provider answered in the last poll; surfaced through `/api/health`. */
  let lastUnmapped: readonly string[] = [];

  async function openStream(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const keys = (url.searchParams.get("keys") ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    // **Bounds before the connection exists**, because a stream is held for as
    // long as its client keeps it: an oversized request refused only after the
    // headers were written would be a held connection that answers 400.
    if (keys.length > MAX_STREAM_KEYS) {
      sendText(
        response,
        400,
        `A stream may ask for ${MAX_STREAM_KEYS} keys at most.`,
      );
      return;
    }

    if (keys.some((key) => Buffer.byteLength(key) > MAX_STREAM_KEY_BYTES)) {
      sendText(
        response,
        400,
        `A stream key may be ${MAX_STREAM_KEY_BYTES} bytes at most.`,
      );
      return;
    }

    // Resolving the display reads the store, and a client that leaves during
    // that read has already emitted the `close` the listeners below would have
    // removed this connection on. So the event is kept until there is a
    // connection to remove — a connection nobody drops writes to a socket that
    // is gone on every later tick.
    let gone = false;
    const noteGone = (): void => {
      gone = true;
    };

    request.on("close", noteGone);
    request.on("error", noteGone);

    const display = await displayKeyFor(request, url, displays);

    request.off("close", noteGone);
    request.off("error", noteGone);

    // The caps are counted after the display is known, because one of them is
    // per display: a single display cannot take every slot, and the total is
    // what a flood of distinct displays would otherwise spend.
    const held = [...connections].filter(
      (connection) => connection.display === display,
    ).length;

    if (
      connections.size >= MAX_STREAM_CONNECTIONS ||
      held >= MAX_STREAM_CONNECTIONS_PER_DISPLAY
    ) {
      sendText(
        response,
        429,
        "This host is already streaming to as many displays as it will.",
      );
      return;
    }

    if (gone) {
      response.end();
      return;
    }

    const connection = new SseConnection(
      response,
      keys,
      display,
      streamLanguage(url),
    );

    connections.add(connection);

    const drop = (): void => {
      connections.delete(connection);
      connection.close();
    };

    request.on("close", drop);
    request.on("error", drop);
    // A display that goes away mid-frame surfaces the reset on the response,
    // not only the request: a write into a socket the client closed raises
    // here, and an unhandled `error` would take the host down with it.
    response.on("error", drop);
  }

  /**
   * Samples once per distinct assignment and offers each display the payload
   * its own assignment produced.
   *
   * A display's theme and answers are read once per tick however many
   * connections it holds, and two displays holding the same devices share one
   * poll: a poll is this PC's work, and the devices are what it reads.
   */
  async function sampleOnce(): Promise<void> {
    if (connections.size === 0) {
      return;
    }

    // The Host's settings, read once for every display in the tick: which GPU
    // answers is this machine's question, not a screen's.
    const stored =
      devices === undefined ? EMPTY_DEVICE_SETTINGS : await devices.read();

    const byDisplay = new Map<string, SseConnection[]>();

    for (const connection of connections) {
      const held = byDisplay.get(connection.display);

      if (held === undefined) {
        byDisplay.set(connection.display, [connection]);
        continue;
      }

      held.push(connection);
    }

    const asks: DisplayAsk[] = [];

    for (const [display, held] of byDisplay) {
      // The newest connection that declares a language speaks for the display;
      // a theme change follows a re-connect, so only disagreement is transient.
      let language: string | undefined;
      for (const connection of held) {
        if (connection.language !== undefined) language = connection.language;
      }

      asks.push({
        display,
        semanticKeys: unionOfKeys(
          held.map((connection) => connection.semanticKeys),
        ),
        assignment: await currentAssignment(display, stored),
        ...(language === undefined ? {} : { language }),
      });
    }

    const unmapped = new Set<string>();
    // One clock for the whole cycle: two displays sampled in the same tick are
    // comparable, which is what a batch's `sentAt` and its samples promise.
    const at = now();

    for (const group of groupByAsk(asks)) {
      const cycle = await registry.sample(group.semanticKeys, at, {
        assignment: group.assignment,
        ...(group.language === undefined ? {} : { language: group.language }),
      });

      // A key no provider even considers would otherwise be absent from the frame
      // entirely, so a display cannot tell "nothing reports this" from "no data
      // yet" (§97). An explicit gap carries the reason to the display.
      const answered = new Set(cycle.entries.map((entry) => entry.semanticKey));
      const timestamp = new Date(at).toISOString();
      const gaps = cycle.unmapped
        .filter((key) => !answered.has(key))
        .map((key) => ({
          semanticKey: key,
          sample: {
            sensorId: "host:" + key,
            timestamp,
            status: "missing" as const,
            message:
              "no provider on this PC reports that sensor; check the device " +
              "assignment or that its source is running",
          },
        }));

      const payload = JSON.stringify(
        createBatch([...cycle.entries, ...gaps], at),
      );
      // Framed once for the group: every connection that shares this batch
      // receives the same bytes rather than formatting its own copy.
      const frame = formatSseEvent(SAMPLE_EVENT, payload);

      for (const key of cycle.unmapped) unmapped.add(key);

      for (const display of group.displays) {
        for (const connection of byDisplay.get(display) ?? []) {
          connection.offer(frame);
        }
      }
    }

    // Recorded for `/api/health` so an unsupported sensor explains itself. Every
    // display's gaps, not the last group's: a sensor nothing reports is
    // unsupported here whatever screen asked.
    lastUnmapped = [...unmapped].sort();
  }

  /**
   * A tick in flight makes the interval skip its next fire, so a provider that
   * stalls cannot stack a second sample batch on the first.
   */
  let ticking = false;

  async function tick(): Promise<void> {
    ticking = true;

    try {
      await sampleOnce();
    } finally {
      // A rejected sample must not wedge the loop behind a flag nothing clears.
      ticking = false;
    }
  }

  const timer = setInterval(() => {
    if (ticking) {
      return;
    }

    void tick().catch(() => {
      // Provider failures are isolated; keep future cycles running.
    });
  }, intervalMs);

  timer.unref();

  return {
    connections,
    openStream,
    lastUnmapped: () => lastUnmapped,
    stop(): void {
      clearInterval(timer);
      // A tick in flight across `stop()` would otherwise leave the flag set
      // for the life of this closure.
      ticking = false;
    },
  };
}
