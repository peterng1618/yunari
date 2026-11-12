// @vitest-environment jsdom
/**
 * The SignalRGB page: the receiver's state, the port field, and the devices the
 * bridge publishes.
 *
 * **What this file owns.** That the page draws every fact a device row has,
 * that a bridge with no device says so in a sentence, that a host which does
 * not answer says so instead of spinning, and that the port field refuses a
 * value the host could never bind while sending a valid one once.
 *
 * **What it does not measure.** jsdom lays nothing out, so nothing here claims
 * how the page looks, and the route's own validation is the host suite's.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import type { SignalRgbRead } from "./client.js";
import { SignalRgbPage } from "./pages/signalrgb-page.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const copy = uiCopy.hostSettings.signalrgb;

const READING: SignalRgbRead = {
  bridge: { listening: true, port: 7788, configuredPort: 7788, error: null },
  devices: [
    {
      id: "kraken-z",
      kind: "kraken",
      name: "NZXT Kraken Z",
      lighting: {
        ledCount: 40,
        udpPort: 7788,
        channels: [{ name: "Kraken Z", leds: 40 }],
        layout: { shape: "ring", width: 4, height: 4 },
        stats: { received: 12, dropped: 3 },
      },
    },
    { id: "fan-hub", kind: "hub", name: "Fan hub" },
  ],
  stats: { received: 12, malformed: 0, dropped: 3 },
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(
  reading: SignalRgbRead | Promise<SignalRgbRead>,
  save: (port: number) => Promise<number> = async (port) => port,
): Promise<HTMLDivElement> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () => {
    mounted.render(
      <SignalRgbPage
        settings={{
          readSignalRgbBridge: async () => reading,
          saveSignalRgbUdpPort: save,
        }}
        write={(run) => {
          void run();
        }}
      />,
    );
  });
  // The page's first read, and the render it causes.
  await act(async () => {});
  return container;
}

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
});

const portField = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    "[data-yunari-signalrgb-port]",
  );
  if (input === null) throw new Error("the page rendered no port field");
  return input;
};

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Enter is the field's commit; the input keeps its draft until then.
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

it("draws a device's LEDs, channels, layout, port and counters", async () => {
  const container = await mount(READING);

  expect(container.textContent).toContain("NZXT Kraken Z");
  expect(container.textContent).toContain("40 LEDs");
  expect(container.textContent).toContain("Kraken Z (40)");
  expect(container.textContent).toContain("ring 4×4");
  expect(container.textContent).toContain("UDP 7788");
  expect(container.textContent).toContain("12 received · 3 dropped");
  expect(container.textContent).toContain(copy.listening(7788));
  // A device with no lighting is listed, not omitted: it is still a subdevice.
  expect(container.textContent).toContain("Fan hub");
  expect(container.textContent).toContain(copy.noLighting);
});

it("says in one sentence that no device is open", async () => {
  const container = await mount({
    ...READING,
    devices: [],
  });

  expect(container.textContent).toContain(copy.noDevices);
  expect(container.querySelector("[data-yunari-signalrgb-device]")).toBeNull();
});

it("says the host did not answer rather than showing an empty table", async () => {
  const container = await mount(Promise.reject(new Error("host down")));

  expect(container.textContent).toContain(copy.unreachable);
  expect(container.querySelector("[data-yunari-signalrgb-device]")).toBeNull();
});

it("refuses a port the host could never bind without saving it", async () => {
  const save = vi.fn(async (port: number) => port);
  const container = await mount(READING, save);

  await typeInto(portField(), "0");
  expect(container.textContent).toContain(uiCopy.controls.atLeast(1));

  await typeInto(portField(), "70000");
  expect(container.textContent).toContain(uiCopy.controls.atMost(65_535));

  expect(save).not.toHaveBeenCalled();
});

it("saves a whole port from 1 to 65535", async () => {
  const save = vi.fn(async (port: number) => port);
  await mount(READING, save);

  await typeInto(portField(), "9000");
  await act(async () => {});

  expect(save).toHaveBeenCalledWith(9000);
});

it("shows the bind failure and the port that will be tried next", async () => {
  const container = await mount({
    bridge: {
      listening: false,
      port: null,
      configuredPort: 9000,
      error: "listen EADDRINUSE 127.0.0.1:9000",
    },
    devices: [],
  });

  expect(container.textContent).toContain(copy.notListening);
  expect(container.textContent).toContain(
    copy.bindFailed("listen EADDRINUSE 127.0.0.1:9000"),
  );
  expect(portField().value).toBe("9000");
});
