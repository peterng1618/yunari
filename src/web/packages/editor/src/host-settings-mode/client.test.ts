import { expect, it, vi } from "vitest";
import { createHostSettingsClient } from "./client.js";

/**
 * The seam's own contract: what each route's answer is read as, and what each
 * write puts on the wire.
 *
 * **It is read here rather than only through the region**, because the region is
 * handed a fake and would not notice a field renamed on either side — the two
 * would agree with each other and disagree with the host. The shapes below are
 * `packages/host/src/server.ts`'s own answers.
 */

/** A host that answers one route and records what it was asked. */
function host(answer: (url: string, init?: RequestInit) => Response): {
  readonly fetch: typeof fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return answer(url, init);
    },
  );
  return { fetch: fetcher as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

it("reads this PC's devices, keeping only the slots it can offer", async () => {
  const { fetch } = host(() =>
    json({
      available: {
        gpus: [{ id: "gpu-0", name: "RTX 4070" }],
        disks: [{ id: "ssd-0", name: "Samsung 990" }],
      },
      assigned: {
        assigned: { gpu: "gpu-0", "data-disk": "ssd-0", monitor: "screen-0" },
        // A device that is not in the list is one that has gone away. Its name
        // is kept rather than pruned: the region writes the map back whole, and
        // dropping it here would lose the name the moment a drive is unplugged.
        names: { "ssd-0": "Data drive", "ssd-9": "Spare drive" },
      },
    }),
  );

  const devices = await createHostSettingsClient({ fetch }).readDevices();

  expect(devices.available.gpus).toEqual([{ id: "gpu-0", name: "RTX 4070" }]);
  expect(devices.available.disks).toEqual([
    { id: "ssd-0", name: "Samsung 990" },
  ]);
  // A slot no control here could offer is dropped rather than rendered: the
  // three are the host's own `ASSIGNABLE_GROUPS`, and a fourth would be a row
  // whose answer nothing reads.
  expect(devices.assigned).toEqual({ gpu: "gpu-0", "data-disk": "ssd-0" });
  expect(devices.names).toEqual({
    "ssd-0": "Data drive",
    "ssd-9": "Spare drive",
  });
});

it("writes both device fields, because the route replaces the object", async () => {
  const { fetch, calls } = host(() =>
    json({ ok: true, assigned: { assigned: { gpu: "gpu-1" }, names: {} } }),
  );

  const saved = await createHostSettingsClient({ fetch }).saveDevices({
    assigned: { gpu: "gpu-1" },
    names: { "ssd-0": "Data drive" },
  });

  expect(calls).toEqual(["PUT /api/devices"]);
  expect(saved).toEqual({ assigned: { gpu: "gpu-1" }, names: {} });
});

it("reads the display settings and refuses a zone this runtime cannot resolve", async () => {
  const { fetch } = host(() =>
    json({
      settings: { timeZone: "Mars/Olympus", measurement: "imperial" },
      zones: ["UTC", "Europe/Paris", 7],
    }),
  );

  const display = await createHostSettingsClient({ fetch }).readDisplay();

  // A stored zone this runtime cannot resolve is dropped rather than printed:
  // the control would otherwise show a value it cannot offer, and the person
  // could not tell that from a choice they made.
  expect(display.settings).toEqual({ measurement: "imperial" });
  expect(display.zones).toEqual(["UTC", "Europe/Paris"]);
});

it("writes both display fields, with this PC's own zone as the empty value", async () => {
  const { fetch, calls } = host(() =>
    json({ ok: true, settings: { measurement: "metric" } }),
  );

  const saved = await createHostSettingsClient({ fetch }).saveDisplay({
    timeZone: "",
    measurement: "metric",
  });

  expect(calls).toEqual(["PUT /api/display"]);
  expect(saved).toEqual({ measurement: "metric" });
});

it("asks about one theme on one display, and keeps only the slots it knows", async () => {
  const { fetch, calls } = host(() =>
    json({
      required: ["gpu", "data-disk", "monitor"],
      answers: { gpu: "gpu-0", monitor: "screen-0" },
    }),
  );

  const asked = await createHostSettingsClient({ fetch }).readQuestions(
    "hallway",
    "hallway clock",
  );

  expect(calls).toEqual([
    "GET /api/themes/hallway%20clock/answers?display=hallway",
  ]);
  expect(asked.required).toEqual(["gpu", "data-disk"]);
  expect(asked.answers).toEqual({ gpu: "gpu-0" });
});

it("answers a refusal with the host's own words", async () => {
  const { fetch } = host(
    () =>
      new Response("Device settings are available on this PC only.", {
        status: 403,
      }),
  );

  await expect(
    createHostSettingsClient({ fetch }).readDevices(),
  ).rejects.toThrow("Device settings are available on this PC only.");
});

it("answers a refusal that carried no words with its own sentence", async () => {
  const { fetch } = host(() => new Response("", { status: 500 }));

  await expect(
    createHostSettingsClient({ fetch }).readDisplay(),
  ).rejects.toThrow("Could not read the display settings (500).");
});

it("sends the whole weather object, omitting a blank label", async () => {
  let body: Record<string, unknown> | undefined;
  const { fetch, calls } = host((_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return json({ ok: true, settings: body });
  });

  const settings = createHostSettingsClient({ fetch });

  // **An absent label is no manual place; an empty one is refused.** The host
  // normalizer refuses `label: ""`, so the blank has to leave the wire, while
  // every other field still travels because the route replaces the object.
  await settings.saveWeather({
    provider: "weatherapi",
    label: "",
    latitude: 52.52,
    longitude: 13.41,
    useWindowsLocation: false,
    pollIntervalMs: 120000,
  });

  expect(calls).toEqual(["PUT /api/weather/settings"]);
  expect(body).toEqual({
    provider: "weatherapi",
    latitude: 52.52,
    longitude: 13.41,
    useWindowsLocation: false,
    pollIntervalMs: 120000,
  });
  expect(body !== undefined && "label" in body).toBe(false);

  // A chosen place is sent, and only the blank is ever omitted.
  await settings.saveWeather({
    provider: "weatherapi",
    label: "Berlin, Berlin, DE",
    latitude: 52.52,
    longitude: 13.41,
    useWindowsLocation: false,
    pollIntervalMs: 120000,
  });
  expect(body?.label).toBe("Berlin, Berlin, DE");
});
