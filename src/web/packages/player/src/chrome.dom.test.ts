// @vitest-environment jsdom

import type { Sample, SampleSource } from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chromeBand,
  putStrip,
  removeStrip,
  showAvailabilityNotice,
  showConnectionState,
} from "./chrome.js";

/**
 * The document `index.html` ships: the chrome's two bands around the artboard
 * host. Built with createElement rather than innerHTML, because the point is to
 * assert against the structure the document declares.
 */
function skeleton(): void {
  document.body.replaceChildren();
  for (const side of ["top", "bottom"] as const) {
    const band = document.createElement("div");
    band.id = `yunari-chrome-${side}`;
    band.dataset["yunariChrome"] = side;
    document.body.append(band);
    if (side === "top") {
      const host = document.createElement("div");
      host.id = "artboard";
      document.body.append(host);
    }
  }
}

function stripsIn(side: "top" | "bottom"): HTMLElement[] {
  return [
    ...chromeBand(side).querySelectorAll<HTMLElement>(
      "[data-yunari-chrome-strip]",
    ),
  ];
}

describe("the display's chrome", () => {
  beforeEach(skeleton);

  it("puts a strip in the band it names, and nowhere else", () => {
    putStrip({
      side: "top",
      id: "yunari-connection",
      text: "Reconnecting",
      background: "#003a4a",
      color: "#7fdce9",
    });

    expect(stripsIn("top")).toHaveLength(1);
    expect(stripsIn("bottom")).toHaveLength(0);
    expect(document.getElementById("yunari-connection")?.textContent).toBe(
      "Reconnecting",
    );
  });

  it("replaces a strip of the same kind rather than stacking it", () => {
    // The availability strip is rebuilt on every refresh cadence and the
    // connection banner changes as the transport moves: one kind of notice is
    // one strip, which each writer used to arrange by removing the old element
    // by hand.
    putStrip({
      side: "top",
      id: "yunari-connection",
      text: "first",
      background: "#003a4a",
      color: "#7fdce9",
    });
    putStrip({
      side: "top",
      id: "yunari-connection",
      text: "second",
      background: "#003a4a",
      color: "#7fdce9",
    });

    expect(document.querySelectorAll("#yunari-connection")).toHaveLength(1);
    expect(document.getElementById("yunari-connection")?.textContent).toBe(
      "second",
    );
  });

  it("leaves an empty band empty, so a quiet display costs no room", () => {
    // This is the property the whole layout rests on: a band with nothing in it
    // is zero tall, so a display with nothing to say gets the whole viewport —
    // measured on the real host before this plan, and preserved by it.
    expect(stripsIn("top")).toHaveLength(0);
    expect(stripsIn("bottom")).toHaveLength(0);
  });

  it("keeps the order the strips were put in, so two notices stay legible apart", () => {
    putStrip({
      side: "top",
      id: "yunari-availability",
      text: "a",
      background: "#3a2a00",
      color: "#ffce6a",
    });
    putStrip({
      side: "top",
      id: "yunari-connection",
      text: "b",
      background: "#003a4a",
      color: "#7fdce9",
    });

    expect(stripsIn("top").map((strip) => strip.id)).toEqual([
      "yunari-availability",
      "yunari-connection",
    ]);
  });

  it("refuses to draw into a document that has no band", () => {
    // The same contract `main.ts:55-57` already has for `#artboard`: a document
    // this renderer cannot draw into fails loudly rather than silently putting
    // a strip somewhere that covers the composition.
    document.body.replaceChildren();

    expect(() => chromeBand("top")).toThrow(/top chrome band/);
  });

  it("takes the empty space back when a strip is removed", () => {
    putStrip({
      side: "bottom",
      id: "yunari-connection",
      text: "Lost the host.",
      background: "#003a4a",
      color: "#7fdce9",
    });
    removeStrip("yunari-connection");

    expect(stripsIn("bottom")).toHaveLength(0);
    expect(document.getElementById("yunari-connection")).toBeNull();
  });
});

describe("the strips the display is told by", () => {
  beforeEach(skeleton);

  it("marks every strip with one attribute, in the band for what it is", () => {
    showConnectionState("reconnecting", 3);

    expect(stripsIn("bottom").map((strip) => strip.id)).toEqual([
      "yunari-connection",
    ]);
  });

  it("clears the transport strip when the connection is live", () => {
    showConnectionState("reconnecting", 3);
    showConnectionState("live", 3);

    expect(stripsIn("bottom")).toHaveLength(0);
  });

  it("overlays every notice it raises, so raising one cannot re-fit the scene", () => {
    // A strip in flow takes room, and taking room re-fits the scene: 16-25px of
    // movement on the built display, right as the notice arrives and left as it
    // leaves (vg-028). Every strip left here is a transport or availability
    // notice, which can flash on any reconnect, so each is fixed to the
    // display's edge instead of laid out in the band. The one strip that took
    // room was the crop notice, and it is gone.
    showConnectionState("reconnecting", 3);
    expect(document.getElementById("yunari-connection")?.style.position).toBe(
      "fixed",
    );
  });

  it("says nothing at all when there is nothing to say", () => {
    // The quiet display: a connection that is live raises no strip.
    showConnectionState("live", 3);

    expect(stripsIn("top")).toHaveLength(0);
    expect(stripsIn("bottom")).toHaveLength(0);
  });
});

/** The display the warning exists for: one bound key nothing on this PC reports. */
const GAP_KEYS = ["host:cpu.temp.1"];

function gapSource(): SampleSource {
  const sample: Sample = {
    sensorId: GAP_KEYS[0] ?? "",
    timestamp: "2026-10-17T00:00:00.000Z",
    status: "missing",
    message: "no provider on this PC reports that sensor",
  };
  return { revision: 0, latest: () => sample, history: () => [] };
}

/** The same display with its reading back — the condition clearing. */
const recoveredSource: SampleSource = {
  revision: 0,
  latest: () => ({
    sensorId: GAP_KEYS[0] ?? "",
    timestamp: "2026-10-17T00:00:00.000Z",
    status: "ok",
    value: 1,
  }),
  history: () => [],
};

describe("the availability warning's own lifetime", () => {
  beforeEach(() => {
    skeleton();
    vi.useFakeTimers();
    // The dismissal is module state, and a test file gets one module: each case
    // starts from the condition clearing, which is also the re-arm path.
    showAvailabilityNotice(recoveredSource, GAP_KEYS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears itself three seconds after it is raised", () => {
    showAvailabilityNotice(gapSource(), GAP_KEYS);
    expect(document.getElementById("yunari-availability")).not.toBeNull();

    vi.advanceTimersByTime(2_999);
    expect(document.getElementById("yunari-availability")).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(document.getElementById("yunari-availability")).toBeNull();
  });

  it("does not re-raise it while the condition persists", () => {
    // The refresh cadence calls this at the frame rate. A warning rebuilt on the
    // next call would flicker back every frame, and one that re-armed its timer
    // on every call would never clear at all — which is the defect a bare
    // `setTimeout` here would have shipped.
    const source = gapSource();
    showAvailabilityNotice(source, GAP_KEYS);
    vi.advanceTimersByTime(3_000);

    for (let call = 0; call < 30; call += 1) {
      showAvailabilityNotice(source, GAP_KEYS);
      expect(document.getElementById("yunari-availability")).toBeNull();
    }

    vi.advanceTimersByTime(30_000);
    expect(stripsIn("top")).toHaveLength(0);
  });

  it("raises it again when the condition has cleared and returns", () => {
    showAvailabilityNotice(gapSource(), GAP_KEYS);
    vi.advanceTimersByTime(3_000);
    showAvailabilityNotice(recoveredSource, GAP_KEYS);
    showAvailabilityNotice(gapSource(), GAP_KEYS);

    expect(document.getElementById("yunari-availability")).not.toBeNull();
  });

  it("overlays it, so raising or clearing it cannot re-fit the scene", () => {
    // The half of the report that landed in `476d8db7`: a strip in flow takes
    // its room from the artboard and the scene re-fits, which moves the whole
    // composition. This is the half that must survive the dismissal.
    showAvailabilityNotice(gapSource(), GAP_KEYS);

    expect(document.getElementById("yunari-availability")?.style.position).toBe(
      "fixed",
    );
  });

  it("gives no other strip a lifetime: the transport notice is unchanged by this", () => {
    // One strip has a dismissal timer and the rest do not. A shared helper that
    // quietly handed every strip one would be that decision made by accident.
    showConnectionState("reconnecting", 3);
    expect(document.getElementById("yunari-connection")).not.toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(document.getElementById("yunari-connection")).not.toBeNull();
  });
});
