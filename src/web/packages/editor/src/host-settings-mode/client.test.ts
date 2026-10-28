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

it("carries the attribution the host answered, and drops an unknown shape", async () => {
  const settings = {
    provider: "weatherapi",
    label: "Berlin, Berlin, DE",
    latitude: 52.52,
    longitude: 13.41,
    useWindowsLocation: false,
    pollIntervalMs: 600000,
  };
  const valid = host(() =>
    json({
      settings,
      attribution: {
        text: "Powered by WeatherAPI.com",
        url: "https://www.weatherapi.com/",
      },
    }),
  );
  expect(
    (await createHostSettingsClient({ fetch: valid.fetch }).readWeather())
      .attribution,
  ).toEqual({
    text: "Powered by WeatherAPI.com",
    url: "https://www.weatherapi.com/",
  });

  // A host of another shape is read as no attribution rather than rendered:
  // the anchor would otherwise carry a value no backend named.
  for (const attribution of [
    { text: 42, url: "https://www.weatherapi.com/" },
    { text: "Powered by WeatherAPI.com", url: "not a url" },
    { text: "", url: "https://www.weatherapi.com/" },
    "Powered by WeatherAPI.com",
    null,
  ]) {
    const broken = host(() => json({ settings, attribution }));
    expect(
      (await createHostSettingsClient({ fetch: broken.fetch }).readWeather())
        .attribution,
      JSON.stringify(attribution),
    ).toBeUndefined();
  }
});

it("keeps the place and cadence when the host names an unknown provider", async () => {
  const { fetch } = host(() =>
    json({
      settings: {
        provider: "meteorologist",
        label: "Paris, Ile-de-France, FR",
        latitude: 48.86,
        longitude: 2.35,
        useWindowsLocation: true,
        pollIntervalMs: 120000,
      },
    }),
  );

  expect(
    await createHostSettingsClient({ fetch }).readWeather(),
    "an unknown provider fell back by blanking the fields beside it",
  ).toEqual({
    provider: "open-meteo",
    label: "Paris, Ile-de-France, FR",
    latitude: 48.86,
    longitude: 2.35,
    useWindowsLocation: true,
    pollIntervalMs: 120000,
  });
});

/**
 * A display's glass and mounting angle travel together: a shape change decides
 * the rule the angle must satisfy, so the store decides the pair. The answer is
 * the record's own reading, and its absent `rotation` for an upright screen
 * reads as `0` rather than as no angle.
 */
it("writes a display's shape and rotation and answers the record's reading", async () => {
  let body: unknown;
  const { fetch, calls } = host((_url, init) => {
    expect(init?.method).toBe("PATCH");
    body = JSON.parse(String(init?.body));
    return json({ id: "tv", shape: "circle", rotation: 45 });
  });

  const saved = await createHostSettingsClient({
    fetch,
  }).updateDisplayPresentation("tv", { shape: "circle", rotation: 45 });

  expect(calls).toEqual(["PATCH /api/displays/tv"]);
  // Both fields and nothing else: the route reads a patch, so a field it does
  // not own would be a value this seam invented.
  expect(body).toEqual({ shape: "circle", rotation: 45 });
  expect(saved).toEqual({ shape: "circle", rotation: 45 });
});

it("reads an upright display's absent rotation as zero", async () => {
  const { fetch } = host(() => json({ id: "tv", shape: "rect" }));

  expect(
    await createHostSettingsClient({ fetch }).updateDisplayPresentation("tv", {
      shape: "rect",
      rotation: 0,
    }),
  ).toEqual({ shape: "rect", rotation: 0 });
});

/**
 * The panels route's own answer, read field by field: a hint's support record
 * is what the surface prints as hardware facts, so a malformed one is dropped
 * whole rather than rendered half-read, and a command this build cannot send
 * never reaches a control.
 */
it("reads a panel's hardware record, dropping what it cannot print", async () => {
  const { fetch, calls } = host(() =>
    json({
      panels: [
        {
          vendorId: 0x1d6b,
          productId: 0x0106,
          serial: "S1",
          label: 'TURZX 5" Panel',
          held: true,
          heldId: "panel-1",
          support: {
            maker: "TURZX",
            hardwareRevision: "Rev C",
            supportedFirmware: ["1.88"],
            updatedAt: "2026-10-29",
          },
          model: "chs_5inch",
          firmware: "1.90",
          commands: ["brightness", "startVideo", "status"],
        },
        {
          vendorId: 0x1cbe,
          productId: 0xa092,
          serial: "S2",
          label: 'Lian Li 9.2" LCD',
          held: false,
          // No revision and no date: a record this build would print as a
          // hardware fact the host never stated.
          support: { maker: "Lian Li", supportedFirmware: [] },
          commands: [],
        },
        // A host before these fields: read as a picture-only panel.
        { vendorId: 0x1cbe, productId: 0xa088, serial: "S3", held: false },
      ],
    }),
  );

  const panels = await createHostSettingsClient({ fetch }).listPanels();

  expect(calls).toEqual(["GET /api/displays/panels"]);
  expect(panels[0]).toEqual({
    vendorId: 0x1d6b,
    productId: 0x0106,
    serial: "S1",
    label: 'TURZX 5" Panel',
    held: true,
    heldId: "panel-1",
    support: {
      maker: "TURZX",
      hardwareRevision: "Rev C",
      supportedFirmware: ["1.88"],
      updatedAt: "2026-10-29",
    },
    model: "chs_5inch",
    firmware: "1.90",
    commands: ["brightness", "status"],
  });
  expect(panels[1]?.support).toBeUndefined();
  expect(panels[2]?.commands).toEqual([]);
});

it("posts a panel command as the route's own body and answers its reply", async () => {
  let sent: RequestInit | undefined;
  const { fetch, calls } = host((_url, init) => {
    sent = init;
    return json({ ok: true, reply: "Brightness set to 50%." });
  });

  const reply = await createHostSettingsClient({ fetch }).panelCommand(
    "strip",
    { kind: "brightness", level: 50 },
  );

  expect(calls).toEqual(["POST /api/displays/strip/panel/command"]);
  // The body is the command itself rather than a wrapper around it: that is
  // what the route parses.
  expect(JSON.parse(String(sent?.body))).toEqual({
    kind: "brightness",
    level: 50,
  });
  expect(reply).toBe("Brightness set to 50%.");
});

it("answers a panel command refusal with the host's plain-text words", async () => {
  // Every failure answer on this route is text, not JSON — a closed port is a
  // 409 whose sentence is the only thing that tells the person what happened.
  const { fetch } = host(
    () => new Response("Panel display strip is not running.", { status: 409 }),
  );

  await expect(
    createHostSettingsClient({ fetch }).panelCommand("strip", {
      kind: "status",
    }),
  ).rejects.toThrow("Panel display strip is not running.");
});
