import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChartRefreshRate } from "@yunari/scene-fabric";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActiveThemeStore } from "./active-theme.js";
import {
  DisplaySettingError,
  normalizePresentation,
} from "./display-presentation.js";
import {
  chartFpsFor,
  createDisplayStore,
  type DisplayStore,
  displayIdFrom,
  hashToken,
  normalizeLabel,
  normalizeMonitor,
} from "./displays.js";
import { createThemeSettingsStore } from "./theme-settings.js";

const FILE = "display-clients.json";

describe("displayIdFrom", () => {
  it("slugs a label into the host's one id shape", () => {
    expect(displayIdFrom("Kitchen Tablet", "")).toBe("kitchen-tablet");
  });

  it("refuses a label that yields nothing usable", () => {
    for (const label of ["???", "---", "   ", "🌡️"]) {
      expect(() => displayIdFrom(label, "a1b2")).toThrow(/usable id/);
    }
  });

  it("shortens a long label so the suffix still fits the 64-character bound", () => {
    const id = displayIdFrom("x".repeat(200), "a1b2");
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.endsWith("-a1b2")).toBe(true);
  });
});

describe("createDisplayStore", () => {
  let directory: string;
  let store: DisplayStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "yunari-displays-"));
    store = createDisplayStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("mints a record and lists it", async () => {
    const record = await store.create("Kitchen tablet", "tok");

    expect(record).toMatchObject({
      id: "kitchen-tablet",
      label: "Kitchen tablet",
      kind: "paired",
    });
    expect(record.tokenHash).toBe(hashToken("tok"));
    expect((await store.list()).map((display) => display.id)).toEqual([
      "kitchen-tablet",
    ]);
    // The write is atomic, so its temporary file is gone once it returns.
    expect(await readdir(directory)).toEqual([FILE]);
  });

  it("adds a suffix when the slug is taken", async () => {
    const deterministic = createDisplayStore(directory, {
      randomSuffix: () => "a1b2",
    });
    const first = await deterministic.create("Kitchen tablet", "tok");
    const second = await deterministic.create("Kitchen tablet", "tok2");

    expect(first.id).toBe("kitchen-tablet");
    expect(second.id).toBe("kitchen-tablet-a1b2");
    expect(await deterministic.list()).toHaveLength(2);
  });

  it("refuses the two reserved ids", async () => {
    await expect(store.create("this pc", "tok")).rejects.toThrow(/reserved/);
    await expect(store.create("default", "tok")).rejects.toThrow(/reserved/);
    expect(await store.list()).toEqual([]);
  });

  it("survives a new store over the same directory", async () => {
    const created = await store.create("Kitchen tablet", "tok");
    const reopened = createDisplayStore(directory);

    expect((await reopened.list()).map((display) => display.id)).toEqual([
      created.id,
    ]);
    expect((await reopened.find(created.id))?.label).toBe("Kitchen tablet");
  });

  it("removes a record", async () => {
    const record = await store.create("Kitchen tablet", "tok");

    expect(await store.remove(record.id)).toBe(true);
    expect(await store.remove(record.id)).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  // Ruling 12 — the credential is durable, hashed, and rotated in place.
  it("never writes the token to the file", async () => {
    const token = "a-token-nobody-should-read";
    await store.create("Kitchen tablet", token);
    const raw = await readFile(path.join(directory, FILE), "utf8");
    expect(raw).not.toContain(token);
    expect(raw).toContain(hashToken(token));
  });

  it("authenticates the token it was given and nothing else", async () => {
    await store.create("Kitchen tablet", "right");
    expect((await store.authenticate("right"))?.id).toBe("kitchen-tablet");
    expect(await store.authenticate("wrong")).toBeUndefined();
    expect(await store.authenticate("")).toBeUndefined();
  });

  it("rotates in place, keeping the record and killing the old token", async () => {
    const before = await store.create("Kitchen tablet", "old");
    const after = await store.rotate(before.id, "new");
    expect(after?.id).toBe(before.id);
    expect(after?.createdAt).toBe(before.createdAt);
    expect(await store.authenticate("old")).toBeUndefined();
    expect((await store.authenticate("new"))?.id).toBe(before.id);
    expect(await store.list()).toHaveLength(1);
  });

  it("answers undefined for rotating a display it does not know", async () => {
    expect(await store.rotate("nobody", "new")).toBeUndefined();
  });

  it("records when a display was last seen", async () => {
    const record = await store.create("Kitchen tablet", "tok");
    await store.touch(record.id, "2026-10-18T00:00:00.000Z");
    expect((await store.find(record.id))?.lastSeenAt).toBe(
      "2026-10-18T00:00:00.000Z",
    );
  });

  it("declines the write for a sighting that has barely moved", async () => {
    const record = await store.create("Kitchen tablet", "tok");
    await store.touch(record.id, "2026-10-18T00:00:00.000Z");
    await store.touch(record.id, "2026-10-18T00:00:02.000Z");

    // A display polls every two seconds and every poll is a sighting, so a
    // write per poll is a whole-file rewrite for a value nothing reads that
    // finely. The stamp is what the skip shows: a write is the only thing that
    // could have moved it.
    expect((await store.find(record.id))?.lastSeenAt).toBe(
      "2026-10-18T00:00:00.000Z",
    );
  });

  it("moves a sighting past the window, in either direction", async () => {
    const record = await store.create("Kitchen tablet", "tok");
    await store.touch(record.id, "2026-10-18T00:00:00.000Z");
    await store.touch(record.id, "2026-10-18T00:00:06.000Z");
    expect((await store.find(record.id))?.lastSeenAt).toBe(
      "2026-10-18T00:00:06.000Z",
    );

    // A clock that ran backwards is not a window this store protects: the value
    // it was given is the one it keeps, as it always did.
    await store.touch(record.id, "2026-10-18T00:00:00.000Z");
    expect((await store.find(record.id))?.lastSeenAt).toBe(
      "2026-10-18T00:00:00.000Z",
    );
  });

  it("keeps a display removed when a removal and a touch overlap", async () => {
    // Both are read-modify-write over the whole file, so without serialization
    // the touch writes back the snapshot it read — the record, with its
    // credential — over the removal, and a revoked display is paired again.
    // The removal starts first and the touch second, which is the interleave
    // that resurrects: the touch reads the file as it was before the removal.
    for (let round = 0; round < 5; round += 1) {
      const token = `tok-${round}`;
      const record = await store.create(`Kitchen tablet ${round}`, token);

      const removing = store.remove(record.id);
      const touching = store.touch(record.id, "2026-10-18T00:00:00.000Z");

      expect(await removing).toBe(true);
      await touching;

      expect(await store.find(record.id), `round ${round}`).toBeUndefined();
      expect(await store.authenticate(token), `round ${round}`).toBeUndefined();
    }
  });

  it("serializes overlapping writes rather than losing the earlier one", async () => {
    // The same shape from the other end: two creations racing must both land, so
    // the file holds both displays rather than the last writer's snapshot.
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        store.create(`Tablet ${index}`, `tok-${index}`),
      ),
    );

    const stored = await store.list();
    expect(stored).toHaveLength(created.length);
    for (const record of created) {
      expect(stored.some((entry) => entry.id === record.id)).toBe(true);
    }
  });

  it("drops a stored record whose tokenHash is missing", async () => {
    // A hand-edited file: a paired display nothing could ever authenticate as.
    await writeFile(
      path.join(directory, FILE),
      JSON.stringify({
        displays: [
          {
            id: "ghost",
            label: "Ghost",
            kind: "paired",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    expect(await store.list()).toEqual([]);
    expect(await store.find("ghost")).toBeUndefined();
    expect(await store.authenticate("anything")).toBeUndefined();
  });

  it("drops the second record of a duplicated id, credential and all", async () => {
    // A hand-edited file: two records claiming one id. The reader keeps the
    // first, so the id is one display — and the dropped record's credential is
    // dropped with it, or a record nothing lists could still pair.
    await writeFile(
      path.join(directory, FILE),
      JSON.stringify({
        displays: [
          {
            id: "kitchen-tablet",
            label: "Kitchen tablet",
            kind: "paired",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
            tokenHash: hashToken("first"),
          },
          {
            id: "kitchen-tablet",
            label: "Kitchen tablet again",
            kind: "paired",
            createdAt: "2026-01-02T00:00:00.000Z",
            lastSeenAt: "2026-01-02T00:00:00.000Z",
            tokenHash: hashToken("second"),
          },
        ],
      }),
      "utf8",
    );

    expect((await store.list()).map((display) => display.id)).toEqual([
      "kitchen-tablet",
    ]);
    expect((await store.find("kitchen-tablet"))?.label).toBe("Kitchen tablet");
    expect((await store.authenticate("first"))?.id).toBe("kitchen-tablet");
    expect(await store.authenticate("second")).toBeUndefined();
  });

  it("ignores a token pasted into the file in the clear", async () => {
    // A hand-edited file: the credential written where the reader only looks for
    // its hash. It is not a credential, so the display authenticates as nothing
    // and is not listed.
    await writeFile(
      path.join(directory, FILE),
      JSON.stringify({
        displays: [
          {
            id: "kitchen-tablet",
            label: "Kitchen tablet",
            kind: "paired",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
            token: "pasted-in-the-clear",
          },
        ],
      }),
      "utf8",
    );

    expect(await store.authenticate("pasted-in-the-clear")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  // A file that is present and unreadable is the owner's only copy of their
  // displays and credentials. Reads fail closed; writes refuse.
  it("refuses to write over a file it could not read", async () => {
    const target = path.join(directory, FILE);
    await writeFile(target, "{ not json", "utf8");
    const before = await readFile(target);

    expect(await store.list()).toEqual([]);
    expect(await store.find("kitchen-tablet")).toBeUndefined();
    expect(await store.authenticate("tok")).toBeUndefined();

    await expect(store.create("Kitchen tablet", "tok")).rejects.toThrow(FILE);
    await expect(
      store.createLocal("Left screen", { deviceName: "\\\\.\\DISPLAY2" }),
    ).rejects.toThrow(FILE);
    await expect(
      store.update("kitchen-tablet", { label: "Kitchen" }),
    ).rejects.toThrow(FILE);
    await expect(store.rotate("kitchen-tablet", "tok")).rejects.toThrow(FILE);
    await expect(
      store.touch("kitchen-tablet", "2026-10-18T00:00:00.000Z"),
    ).rejects.toThrow(FILE);
    await expect(store.remove("kitchen-tablet")).rejects.toThrow(FILE);

    // Byte-identical: nothing deleted, truncated or overwritten it.
    expect(await readFile(target)).toEqual(before);
    expect(await readdir(directory)).toEqual([FILE]);
  });

  it("treats a missing file as a fresh install", async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.find("kitchen-tablet")).toBeUndefined();
    expect((await store.create("Kitchen tablet", "tok")).id).toBe(
      "kitchen-tablet",
    );
  });

  // Renaming: the label moves, the id does not.
  it("renames without moving the id or the creation time", async () => {
    const before = await store.create("office tv", "tok");
    const after = await store.update(before.id, { label: "Kitchen" });
    expect(after).toMatchObject({
      id: before.id,
      label: "Kitchen",
      createdAt: before.createdAt,
    });
    expect((await store.find(before.id))?.label).toBe("Kitchen");
  });

  it("refuses a label that is empty or only whitespace", async () => {
    const record = await store.create("office tv", "tok");
    for (const label of ["", "   ", "\t\n"]) {
      await expect(store.update(record.id, { label })).rejects.toThrow(/label/);
      expect(() => normalizeLabel(label)).toThrow(/label/);
    }
    expect((await store.find(record.id))?.label).toBe("office tv");
  });

  it("trims a label, and accepts one the slug rule would refuse", async () => {
    const record = await store.create("office tv", "tok");
    expect(
      (await store.update(record.id, { label: "  Living Room (TV)  " }))?.label,
    ).toBe("Living Room (TV)");
  });

  it("answers undefined for renaming a display it does not know", async () => {
    expect(await store.update("nobody", { label: "Kitchen" })).toBeUndefined();
  });

  it("lets two displays hold the same label", async () => {
    const a = await store.create("Kitchen", "t1");
    const b = await store.create("Kitchen", "t2");
    await store.update(b.id, { label: "Kitchen" });
    expect(a.id).not.toBe(b.id);
    expect(
      (await store.list()).filter((d) => d.label === "Kitchen"),
    ).toHaveLength(2);
  });

  // Item 9's second clause: the list disambiguates, and neither display may
  // lose its theme or its answers to the other. Both are keyed by the id, so a
  // rename onto a label already in the list has to leave each one's own
  // resolution standing — a resolution keyed on the label would hand the second
  // display's theme and answers to the first.
  it("keeps each colliding label's own theme and answers on its own id", async () => {
    const activeTheme = createActiveThemeStore(directory);
    const answers = createThemeSettingsStore(directory);
    const first = await store.create("Kitchen", "t1");
    const second = await store.create("Kitchen", "t2");

    await activeTheme.write(first.id, "living-room");
    await activeTheme.write(second.id, "studio");
    // One theme, answered differently: the two Kitchens are showing the same
    // dashboard and reading a different GPU.
    await answers.write(first.id, "living-room", { gpu: "gpu-0" });
    await answers.write(second.id, "living-room", { gpu: "gpu-1" });

    expect(first.label).toBe(second.label);
    expect(await activeTheme.read(first.id, async () => true)).toBe(
      "living-room",
    );
    expect(await activeTheme.read(second.id, async () => true)).toBe("studio");
    expect(await answers.read(first.id, "living-room")).toEqual({
      gpu: "gpu-0",
    });
    expect(await answers.read(second.id, "living-room")).toEqual({
      gpu: "gpu-1",
    });
    expect(first.id).not.toBe(second.id);
  });

  // A local monitor is a display with no credential.
  it("mints a local display with no tokenHash, and it never authenticates", async () => {
    const local = await store.createLocal("Left screen", {
      deviceName: "\\\\.\\DISPLAY2",
      serial: "abc",
    });
    expect(local.kind).toBe("local");
    expect(local.tokenHash).toBeUndefined();
    expect(local.monitor).toEqual({
      deviceName: "\\\\.\\DISPLAY2",
      serial: "abc",
    });
    expect(await store.authenticate("")).toBeUndefined();
    // A credentialless display has no token to rotate.
    expect(await store.rotate(local.id, "new")).toBeUndefined();

    // R27: a serial that is blank is absence, not a value — a hint carrying ""
    // matches nothing, so the display would read as detached for ever (vg-616).
    expect(
      normalizeMonitor({ deviceName: "\\\\.\\DISPLAY2", serial: "   " }),
    ).toStrictEqual({ deviceName: "\\\\.\\DISPLAY2" });
    expect(
      normalizeMonitor({ deviceName: "\\\\.\\DISPLAY2", serial: " 4790 " }),
    ).toStrictEqual({ deviceName: "\\\\.\\DISPLAY2", serial: "4790" });
  });

  // One monitor holds one local display (ruling 32): the hint *is* a local
  // display's identity, so a second record for one screen has no window the
  // first does not already have.
  it("refuses a second local display for a monitor one already holds", async () => {
    await store.createLocal("Left screen", {
      deviceName: "\\\\.\\DISPLAY2",
      serial: "4790810010513",
    });

    await expect(
      store.createLocal("Left screen again", {
        deviceName: "\\\\.\\DISPLAY2",
        serial: "4790810010513",
      }),
    ).rejects.toThrow(/already holds/);
    expect(await store.list()).toHaveLength(1);

    // A blank serial is no serial, so a hint carrying one is the same hint — and
    // a device name that moved is the same screen when both ends have a serial.
    await expect(
      store.createLocal("Left screen again", {
        deviceName: "\\\\.\\DISPLAY9",
        serial: " 4790810010513 ",
      }),
    ).rejects.toThrow(/already holds/);
    await expect(
      store.createLocal("Left screen again", {
        deviceName: "\\\\.\\DISPLAY2",
      }),
    ).rejects.toThrow(/already holds/);
    expect(await store.list()).toHaveLength(1);

    // A different monitor is a different display, and a paired record carries no
    // hint at all, so neither is refused.
    const other = await store.createLocal("Right screen", {
      deviceName: "\\\\.\\DISPLAY3",
    });
    expect(other.kind).toBe("local");
    expect(await store.create("Kitchen tablet", "tok")).toBeDefined();
    expect(await store.list()).toHaveLength(3);
  });

  it("refuses to mint a local display for a reserved id", async () => {
    await expect(
      store.createLocal("this pc", { deviceName: "\\\\.\\DISPLAY2" }),
    ).rejects.toThrow(/reserved/);
  });

  // The rate is per display, defaulted by kind (ruling, 2026-10-18).
  it("defaults the rate by kind and lets a record override it", () => {
    expect(chartFpsFor({ kind: "local" })).toBe(1);
    expect(chartFpsFor({ kind: "paired" })).toBe(30);
    expect(chartFpsFor({ kind: "local", chartFps: 30 })).toBe(30);
    expect(chartFpsFor({ kind: "paired", chartFps: 1 })).toBe(1);
  });

  it("keeps a stored rate and refuses one that is not 1 or 30", async () => {
    const record = await store.create("Kitchen tablet", "tok");
    expect((await store.update(record.id, { chartFps: 1 }))?.chartFps).toBe(1);
    expect(
      (await createDisplayStore(directory).find(record.id))?.chartFps,
    ).toBe(1);

    // Untrusted input — a request body, a hand-edited file — is refused, not
    // coerced to the kind's default.
    await expect(
      store.update(record.id, { chartFps: 7 as ChartRefreshRate }),
    ).rejects.toThrow(/rate/);
    expect((await store.find(record.id))?.chartFps).toBe(1);

    // A rate the file cannot carry is dropped on read, so the kind's default
    // answers instead of a rate the player cannot run.
    await writeFile(
      path.join(directory, FILE),
      JSON.stringify({
        displays: [
          {
            id: record.id,
            label: "Kitchen tablet",
            kind: "paired",
            createdAt: record.createdAt,
            lastSeenAt: record.createdAt,
            tokenHash: hashToken("tok"),
            chartFps: 7,
          },
        ],
      }),
      "utf8",
    );

    const stored = await createDisplayStore(directory).find(record.id);
    if (stored === undefined) throw new Error("the record was dropped");
    expect(stored.chartFps).toBeUndefined();
    expect(chartFpsFor(stored)).toBe(30);
  });

  // A display's glass and its mounting angle: stored with the record, because
  // both are properties of the screen rather than of the theme it shows.
  it("stores shape and omits a zero rotation", async () => {
    const record = await store.create("Tablet", "token", {
      shape: "circle",
      rotation: 0,
    });
    expect(record).toMatchObject({ shape: "circle" });
    expect(record.rotation).toBeUndefined();

    // Absent presentation is a rectangular, upright screen.
    const plain = await store.create("Plain", "token");
    expect(plain.shape).toBe("rect");
    expect(plain.rotation).toBeUndefined();
  });

  it("refuses a quarter turn that is not a quarter", async () => {
    await expect(
      store.create("Tablet", "token", { shape: "rect", rotation: 45 }),
    ).rejects.toBeInstanceOf(DisplaySettingError);
    // 360 is a full turn and upright on a circle; a rectangle takes 0/90/180/270
    // exactly, so the wrap is the circle's and not a licence for a rect.
    await expect(
      store.create("Tablet", "token", { shape: "rect", rotation: 360 }),
    ).rejects.toBeInstanceOf(DisplaySettingError);
    expect(await store.list()).toEqual([]);
  });

  it("refuses a rotation that is not a whole degree in range", async () => {
    // Untrusted input — a request body, a hand-edited file — is refused, never
    // clamped or coerced to upright.
    for (const rotation of [
      45.5,
      -90,
      361,
      Number.NaN,
      "90",
    ] as unknown as number[]) {
      await expect(
        store.create("Tablet", "token", { shape: "circle", rotation }),
      ).rejects.toBeInstanceOf(DisplaySettingError);
    }
    expect(() => normalizePresentation("round", 0)).toThrow(
      DisplaySettingError,
    );
    expect(await store.list()).toEqual([]);
  });

  it("accepts any whole degree on a circle and normalises 360", async () => {
    const record = await store.create("Round", "token", {
      shape: "circle",
      rotation: 360,
    });
    expect(record.rotation).toBeUndefined();
    const free = await store.create("Tilted", "token", {
      shape: "circle",
      rotation: 37,
    });
    expect(free.rotation).toBe(37);
  });

  it("snaps a stored free angle when the shape becomes rect", async () => {
    const record = await store.create("Round", "token", {
      shape: "circle",
      rotation: 37,
    });
    const updated = await store.update(record.id, { shape: "rect" });
    expect(updated).toMatchObject({ shape: "rect" });
    expect(updated?.rotation).toBeUndefined();
  });

  it("refuses a patch rotation the final shape cannot hold", async () => {
    const record = await store.create("Tablet", "token", { shape: "rect" });
    await expect(
      store.update(record.id, { rotation: 45 }),
    ).rejects.toBeInstanceOf(DisplaySettingError);
    expect((await store.find(record.id))?.rotation).toBeUndefined();

    // Both fields in one patch are applied as one: the new shape decides the
    // rule the new rotation must satisfy.
    await expect(
      store.update(record.id, { shape: "circle", rotation: 45.5 }),
    ).rejects.toBeInstanceOf(DisplaySettingError);
    expect(
      (await store.update(record.id, { shape: "circle", rotation: 45 }))
        ?.rotation,
    ).toBe(45);
    expect((await store.find(record.id))?.shape).toBe("circle");
  });

  it("reads an invalid stored shape as rect and drops its rotation", async () => {
    await writeFile(
      path.join(directory, FILE),
      JSON.stringify({
        displays: [
          {
            id: "odd",
            label: "Odd",
            kind: "paired",
            createdAt: "2026-10-18T00:00:00.000Z",
            lastSeenAt: "2026-10-18T00:00:00.000Z",
            tokenHash: hashToken("tok"),
            shape: "round",
            rotation: 45,
          },
          {
            id: "square",
            label: "Square",
            kind: "paired",
            createdAt: "2026-10-18T00:00:00.000Z",
            lastSeenAt: "2026-10-18T00:00:00.000Z",
            tokenHash: hashToken("tok2"),
            shape: "rect",
            rotation: 45,
          },
        ],
      }),
      "utf8",
    );

    const stored = await store.list();
    for (const record of stored) {
      expect(record.shape).toBe("rect");
      expect(record.rotation).toBeUndefined();
    }
    expect(stored).toHaveLength(2);
  });
});
