import { type ChildProcess, spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { HOST_APP_DIR, HOST_PORT } from "./host-theme.js";
import { isDesktopSurface } from "./surface.js";

/** Changing media on the real player, and the paired display that has to fetch
 *  it. Both are the last part of the acceptance clause
 *  ("... grouped/rotated/overlapping panels and changing media"), and both run
 *  against the real Node host — `vite preview` has no asset route, no content
 *  type and no session, so none of this is reachable there.
 *
 *  The claim throughout is **pixels**. A `200`, a `naturalWidth` or an element
 *  existing proves the bytes arrived; it does not prove anything was drawn. The
 *  two places media can be read are both used, because they answer different
 *  questions: the glass panel's own pixels on the player's canvas (where the
 *  media is composited, and the only place a `<video>` frame can show up at
 *  all), and a screenshot of the composited artboard (where the media layer is
 *  visible as a DOM sibling *below* the canvas). */

/** The display under test. A second host serves the LAN half, so it must not
 *  collide with the one Playwright started for every other spec. */
const HOST = `http://127.0.0.1:${HOST_PORT}`;

/** One theme per project, because `desktop-host` and `phone-host` can run at the
 *  same time against one themes directory. The id is part of the URL, so the
 *  two runs never read each other's package. */
const themeId = (project: string): string => `e2e-changing-${project}`;

const ARTBOARD = { width: 640, height: 360 } as const;

/** A glass panel over the whole middle of the artboard: the region the video
 *  frame is read back through, and large enough that a 96x96 source upscaled
 *  by `cover` still fills it. */
const PANEL = { left: 120, top: 50, width: 400, height: 260 } as const;
const PANEL_ID = "media-panel";

/** The palette entry the transparent artboard paints. Opaque would cover the
 *  media layer, which sits below the canvas — the same reason the grouped
 *  fixture's artboard is transparent. */
const envelope = (id: string) => ({
  schemaVersion: 2 as const,
  fabricVersion: "7.4.0",
  id,
  metadata: { name: "E2E changing media", themeLanguage: "en" },
  artboard: {
    width: ARTBOARD.width,
    height: ARTBOARD.height,
    contentFit: "cover" as const,
  },
  background: {
    color: { ref: "palette.none" as const },
    media: { assetId: "loop", bounds: "theme" as const },
  },
  globals: {
    palette: {
      none: {
        name: "None",
        value: { kind: "solid" as const, color: "transparent" },
      },
      bar: { name: "Bar", value: { kind: "solid" as const, color: "#101318" } },
      panel: {
        name: "Panel",
        value: { kind: "solid" as const, color: "rgba(255, 255, 255, 0.10)" },
      },
      edge: {
        name: "Edge",
        value: { kind: "solid" as const, color: "rgba(255, 255, 255, 0.35)" },
      },
    },
    typePresets: {},
  },
  assets: [
    {
      id: "loop",
      kind: "video" as const,
      path: "assets/loop.webm",
      license: {
        name: "CC0",
        attribution: "Recorded in-test by canvas capture.",
      },
    },
    {
      id: "badge",
      kind: "svg" as const,
      path: "assets/badge.svg",
      license: { name: "MIT", attribution: "Yunari test fixture." },
    },
  ],
  scene: {
    version: "7.4.0" as const,
    objects: [
      {
        type: "Rect",
        version: "7.4.0",
        originX: "left" as const,
        originY: "top" as const,
        left: PANEL.left,
        top: PANEL.top,
        width: PANEL.width,
        height: PANEL.height,
        rx: 24,
        ry: 24,
        fill: "rgba(255, 255, 255, 0.10)",
        stroke: "rgba(255, 255, 255, 0.35)",
        strokeWidth: 2,
        id: PANEL_ID,
        selectable: false,
        evented: false,
        yunariPaint: { fill: "palette.panel", stroke: "palette.edge" },
        yunariGlass: { blurRadius: 16 },
      },
    ],
  },
  bindings: {},
});

/** The ink the replacement asset paints, so a screenshot can count it. */
const BADGE_INK = { r: 232, g: 236, b: 243 } as const;

const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="10" fill="#e8ecf3" />
</svg>
`;

/**
 * A real, decodable WebM that alternates between two saturated primaries.
 *
 * Encoded here rather than committed, for the same reason the font fixture is
 * downloaded: a binary in the repository buys nothing a recorder does not, and
 * the bytes only have to be decodable *by this browser* — which is the only
 * thing that will ever decode them.
 *
 * **Saturated primaries, not a hue sweep.** A blur is symmetric, so it
 * preserves which channel dominates; a hue sweep does not give a reading that
 * separates "the glass resampled" from "the glass held a stale frame", because
 * the dominant channel of a mid-hue frame is whatever the sweep last passed.
 * Red against blue is unambiguous in both directions.
 *
 * **A long dwell, because a short one makes the test unanswerable.** The panel
 * composites whichever frame the media held at its last repaint, so a reading
 * taken across a transition legitimately disagrees with the source read beside
 * it. At a 250 ms dwell that accounted for 5 of 12 readings (measured), which
 * says nothing about the glass. A second and a half per state leaves a wide
 * window in which source and panel must agree, and the reader discards a
 * sample whose source changed while it was being taken.
 */
async function recordWebm(page: Page): Promise<Uint8Array> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context for the fixture");
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (mimeType === undefined) {
      throw new Error("this browser cannot record the fixture's video");
    }
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start();
    for (let frame = 0; frame < 8; frame += 1) {
      context.fillStyle = frame % 2 === 0 ? "#ff0000" : "#0000ff";
      context.fillRect(0, 0, 96, 96);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Publishes the theme through the host's own admin write route, so the bytes
 *  the display later fetches went in and out of the real store. The library is
 *  a folder (ADR-0017), so the route takes the document and its declared bytes
 *  as JSON — the archive is only ever what an author exports. */
async function publish(
  page: Page,
  id: string,
  webm: Uint8Array,
): Promise<void> {
  const theme = {
    envelope: envelope(id),
    assets: {
      "assets/loop.webm": webm,
      "assets/badge.svg": new TextEncoder().encode(badge),
    },
  };
  // Validated by the archive writer too, so a fixture that cannot be exported
  // cannot be saved, and the failure names the real problem.
  const written = writeThemePackage(theme);
  if (!written.ok)
    throw new Error(`the fixture is invalid: ${written.message}`);

  const response = await page.request.put(`${HOST}/api/themes/${id}`, {
    data: {
      envelope: theme.envelope,
      assets: Object.fromEntries(
        Object.entries(theme.assets).map(([assetPath, bytes]) => [
          assetPath,
          Buffer.from(bytes).toString("base64"),
        ]),
      ),
    },
  });
  expect(
    response.status(),
    `the host accepted the fixture theme: ${await response.text().catch(() => "")}`,
  ).toBe(200);
}

/**
 * The panel's own device-space region, and what is painted there.
 *
 * **The alpha floor is 128, and that number was measured, not chosen.** The
 * panel is a translucent white fill compositing a blurred backdrop, so its
 * pixels top out around 157 (measured peak); a floor of 200 reads an empty
 * region and the test passes or fails on nothing.
 *
 * **`dominant`, not a mean.** A region mean sits at 246-255 for a red video
 * *and* for a blue one, because the panel's own white fill dominates the
 * average — it cannot tell the two apart, which was measured directly. The
 * dominant channel can: a blur is symmetric, so blurring a flat field leaves
 * which channel wins unchanged, and the fill shifts all three channels
 * together without changing the ordering.
 *
 * The region is the panel's own transformed box, not an artboard rectangle: the
 * artboard is fitted and scaled, so artboard coordinates address the wrong
 * pixels at every viewport but the one they were written for.
 */
function panelInk(page: Page): Promise<{
  dominant: "red" | "green" | "blue" | "none";
  opaque: number;
}> {
  return page.evaluate((panelId) => {
    type Obj = {
      get(n: string): unknown;
      width: number;
      height: number;
      calcTransformMatrix(): number[];
    };
    const canvas = (
      window as unknown as {
        yunari?: {
          handle: {
            canvas: {
              getObjects(): Obj[];
              viewportTransform: number[];
              lowerCanvasEl: HTMLCanvasElement;
              getRetinaScaling(): number;
            };
          };
        };
      }
    ).yunari?.handle.canvas;
    if (canvas === undefined) throw new Error("the player has not mounted");
    const object = canvas
      .getObjects()
      .find((candidate) => candidate.get("id") === panelId);
    if (object === undefined) throw new Error(`no object ${panelId}`);
    const m = object.calcTransformMatrix();
    const vp = canvas.viewportTransform;
    const retina = canvas.getRetinaScaling();
    // Local -> scene -> device, the same composition `glass.ts` samples through.
    const toDevice = (x: number, y: number): readonly [number, number] => {
      const sceneX = m[0]! * x + m[2]! * y + m[4]!;
      const sceneY = m[1]! * x + m[3]! * y + m[5]!;
      return [
        (vp[0]! * sceneX + vp[2]! * sceneY + vp[4]!) * retina,
        (vp[1]! * sceneX + vp[3]! * sceneY + vp[5]!) * retina,
      ];
    };
    const halfWidth = object.width / 2;
    const halfHeight = object.height / 2;
    const corners = [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ].map(([x, y]) => toDevice(x!, y!));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const left = Math.max(0, Math.round(Math.min(...xs)));
    const top = Math.max(0, Math.round(Math.min(...ys)));
    const width =
      Math.min(canvas.lowerCanvasEl.width, Math.round(Math.max(...xs))) - left;
    const height =
      Math.min(canvas.lowerCanvasEl.height, Math.round(Math.max(...ys))) - top;
    const data = canvas.lowerCanvasEl
      .getContext("2d")!
      .getImageData(left, top, width, height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let opaque = 0;
    // The stroke and the blurred edge thin out, so the interior is read; the
    // floor is the measured peak of a translucent panel, not a round number.
    const inset = Math.round(Math.min(width, height) / 8);
    for (let y = inset; y < height - inset; y += 1) {
      for (let x = inset; x < width - inset; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i + 3]! < 128) continue;
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        opaque += 1;
      }
    }
    if (opaque === 0) {
      return { dominant: "none" as const, opaque: 0 };
    }
    const totals = { red: r, green: g, blue: b };
    const dominant = (Object.keys(totals) as Array<keyof typeof totals>).reduce(
      (best, key) => (totals[key] > totals[best] ? key : best),
      "red" as keyof typeof totals,
    );
    return { dominant, opaque };
  }, PANEL_ID);
}

/** Which primary the video's own current frame favours — the control. It says
 *  what the media is showing *now*, so a panel showing anything else is stale
 *  rather than merely different. */
function videoDominant(page: Page): Promise<"red" | "green" | "blue"> {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>(
      "[data-yunari-background-media] video",
    );
    if (video === null || video.readyState < 2 || video.videoWidth === 0) {
      throw new Error("the media layer holds no decoded video frame");
    }
    const probe = document.createElement("canvas");
    probe.width = video.videoWidth;
    probe.height = video.videoHeight;
    const context = probe.getContext("2d")!;
    context.drawImage(video, 0, 0);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    const totals = { red: r, green: g, blue: b };
    return (Object.keys(totals) as Array<keyof typeof totals>).reduce(
      (best, key) => (totals[key] > totals[best] ? key : best),
      "red" as keyof typeof totals,
    );
  });
}

/** Pixels of the badge's own ink in the bytes the display actually decoded.
 *
 * Zero until it decodes, and zero forever if the host never served them — which
 * a status check on the URL cannot tell apart from a 200 that is not an image.
 * A token-mangled URL lands on the app shell, so this is what separates "the
 * asset was fetched" from "the asset arrived". */
function decodedInk(page: Page): Promise<number> {
  return page.evaluate(({ r, g, b }) => {
    const image = document.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    if (image === null || !image.complete || image.naturalWidth === 0) {
      return 0;
    }
    const probe = document.createElement("canvas");
    probe.width = image.naturalWidth;
    probe.height = image.naturalHeight;
    const context = probe.getContext("2d");
    if (context === null) return -1;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        data[i + 3]! > 200 &&
        Math.abs(data[i]! - r) <= 12 &&
        Math.abs(data[i + 1]! - g) <= 12 &&
        Math.abs(data[i + 2]! - b) <= 12
      ) {
        ink += 1;
      }
    }
    return ink;
  }, BADGE_INK);
}

/** Pixels of one colour in a screenshot of the composited artboard.
 *
 * This is the only reading that includes the media layer at all: the element's
 * own bitmap proves it decoded, and this proves the display showed it. */
async function compositedInk(
  page: Page,
  ink: { r: number; g: number; b: number },
): Promise<number> {
  const shot = (await page.locator("#artboard").screenshot()).toString(
    "base64",
  );
  return page.evaluate(
    async ([data, r, g, b]) => {
      const bytes = Uint8Array.from(atob(data!), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i]! - r!) <= 12 &&
          Math.abs(pixels[i + 1]! - g!) <= 12 &&
          Math.abs(pixels[i + 2]! - b!) <= 12
        ) {
          count += 1;
        }
      }
      return count;
    },
    [shot, ink.r, ink.g, ink.b] as const,
  );
}

/**
 * A clip that presents a **new frame on every animation frame**, which the
 * dwell fixture above cannot do.
 *
 * `canvas.captureStream` only emits a frame when the canvas *changes*, so a
 * fixture that repaints once every 1500 ms encodes eight frames across ten
 * seconds and the display presents **one new frame per second** — measured,
 * not assumed: the dwell fixture delivered 1, 2, 3, 3, 4, 5, 6, 6 callbacks
 * over eight one-second samples. That is correct `requestVideoFrameCallback`
 * behaviour and it is exactly why the dwell fixture cannot carry a cadence
 * claim. This one repaints every frame, so the callback fires as often as the
 * compositor presents.
 *
 * A 16:9 source, because the fixture artboard is 16:9 and `cover` then shows
 * the whole frame: a bar at a given fraction of the width is at that same
 * fraction behind the panel, which is what makes the picture locatable.
 */
async function recordPerFrameWebm(page: Page): Promise<Uint8Array> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context for the fixture");
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (mimeType === undefined) {
      throw new Error("this browser cannot record the fixture's video");
    }
    const recorder = new MediaRecorder(canvas.captureStream(60), { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start();
    const started = performance.now();
    let frame = 0;
    await new Promise<void>((done) => {
      const draw = (): void => {
        frame += 1;
        context.fillStyle = "#000000";
        context.fillRect(0, 0, 320, 180);
        // A bright bar that walks the whole width, so no two frames are alike.
        const x = (frame % 48) * (320 / 48);
        context.fillStyle = "#ffffff";
        context.fillRect(x, 0, 6, 180);
        if (performance.now() - started > 1600) {
          done();
          return;
        }
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * The video frame callback, and what the player can and cannot see of it.
 *
 * `followFrames` arms `requestVideoFrameCallback` so a playing video repaints
 * the glass beneath it. On the **editor** it is the only thing that does: the
 * editor's media mount hands `requestRenderAll` to `onFrame` and the editor
 * runs no repaint loop of its own, so without the callback a frosted panel
 * freezes on the video's first frame. (`background-media.dom.test.ts` covers
 * the arming and the re-arming; nothing browser-tests the editor's freeze,
 * which is a named gap, not a claim here.)
 *
 * The **player** is different, and this is the measurement rather than the
 * expectation. Both of its mount paths start `startChartRefresh(tick, 30)` on
 * `requestAnimationFrame`, so it already repaints on every animation frame the
 * compositor offers — and a video frame is presented *as* an animation frame,
 * so the callback's `requestRenderAll` lands in a frame that already has one
 * and Fabric coalesces the two into a single render. Counted over three
 * seconds on this machine, against the per-frame clip above:
 *
 * ```
 *                      requestRenderAll calls   renders   rVFC deliveries
 *   callback deleted           92                 40            0
 *   callback armed            143                 50           49
 * ```
 *
 * 92 requests already became 40 renders with no callback at all, and the
 * callback's 51 extra requests added 10 renders. **The player cannot attribute
 * renders to this mechanism**, and a test that passed with the mechanism
 * removed would be a test of something else.
 *
 * So the test asserts the two things that are true and machine-independent:
 *
 * 1. **The mechanism is live and following frames.** If `followFrames` rots,
 *    delivery stops and this goes red.
 * 2. **Withholding delivery does not collapse the display's repainting** — the
 *    control, run mid-mount on the same page and the same scene. This is the
 *    non-distinguishability stated as a measurement, and it is also the
 *    tripwire: if the player ever stops repainting on animation frames, the
 *    second phase collapses and this goes red at the moment the callback
 *    *does* become load-bearing.
 *
 * Delivery is switched by **withholding the callback from the page**, not by
 * removing the API, so the product's own arming path runs in both phases and
 * they differ by exactly one variable.
 */
const FRAME_DELIVERY = `
window.__frameProbe = { delivered: 0, withheld: 0, allow: true };
const proto = HTMLVideoElement.prototype;
const native = proto.requestVideoFrameCallback;
proto.requestVideoFrameCallback = function (callback) {
  const state = window.__frameProbe;
  // **The element, captured here.** Inside the callback \`this\` is a
  // \`VideoFrameCallbackContext\`, not the video — so a re-arm written as
  // \`this.requestVideoFrameCallback(callback)\` calls a method the context does
  // not have, throws, and the count stays at zero for ever. Measured, not
  // assumed: that is what the withholding phase read before the element was
  // captured in a closure.
  const element = this;
  return native.call(element, function (now, metadata) {
    // **The probe re-arms itself.** \`followFrames\` re-arms from inside its own
    // callback, so a wrapper that returns without calling it ends the product's
    // chain after exactly one frame — and \`withheld\` would then count one,
    // never the browser's cadence. Re-arming here measures what the browser is
    // presenting, which is what the control claims: the video kept playing and
    // the page kept throwing those frames away.
    if (!state.allow) {
      state.withheld += 1;
      return element.requestVideoFrameCallback(callback);
    }
    state.delivered += 1;
    return callback(now, metadata);
  });
};
`;

test.describe("the video frame callback on the real player", () => {
  test("is armed and following frames, and the player repaints without it", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "a decoded video frame and its glass are a desktop read",
    );
    const id = themeId(testInfo.project.name);
    await page.addInitScript({ content: FRAME_DELIVERY });
    await publish(page, id, await recordPerFrameWebm(page));

    await page.setViewportSize({ width: 1280, height: 960 });
    await page.goto(`${HOST}/?theme=${id}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const video = document.querySelector<HTMLVideoElement>(
              "[data-yunari-background-media] video",
            );
            return video === null
              ? -1
              : video.readyState * 1000 + video.videoWidth;
          }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(2000);

    /** Renders and deliveries over one window, from the player's own canvas
     *  event and the page's own callback wrapper, in a single read. */
    const over = async (
      ms: number,
    ): Promise<{ renders: number; delivered: number; withheld: number }> =>
      page.evaluate(async (duration) => {
        const scope = window as unknown as {
          __renders: number;
          __frameProbe: { delivered: number; withheld: number };
          yunari: {
            handle: {
              canvas: {
                on(event: string, cb: () => void): void;
                off(event: string, cb: () => void): void;
              };
            };
          };
        };
        const state = scope.__frameProbe;
        const before = {
          delivered: state.delivered,
          withheld: state.withheld,
        };
        scope.__renders = 0;
        const bump = (): void => {
          scope.__renders += 1;
        };
        const canvas = scope.yunari.handle.canvas;
        canvas.on("after:render", bump);
        await new Promise((done) => setTimeout(done, duration));
        canvas.off("after:render", bump);
        return {
          renders: scope.__renders,
          delivered: state.delivered - before.delivered,
          withheld: state.withheld - before.withheld,
        };
      }, ms);

    // **Phase A — the mechanism armed.** The callback is really being called
    // and really is delivering, on every window this test takes.
    const armed = await over(3000);
    expect(
      armed.delivered,
      "the product's frame callback is armed and following frames",
    ).toBeGreaterThan(8);
    expect(
      armed.renders,
      "and the display repaints while it does",
    ).toBeGreaterThan(4);

    // **Phase B — delivery withheld, same page, same scene.** The product's
    // chain is still armed; the page simply stops handing it frames, which is
    // what removing the mechanism would leave behind.
    await page.evaluate(() => {
      (
        window as unknown as { __frameProbe: { allow: boolean } }
      ).__frameProbe.allow = false;
    });
    // The in-flight callback drains within one frame, and that is the product's
    // chain ending — nothing re-arms it but its own callback. The probe keeps
    // re-arming, so `withheld` stays a count of frames the browser is still
    // presenting.
    await page.waitForTimeout(500);
    const idle = await over(3000);
    // **The video is still playing.** `withheld` counts frames the *browser*
    // presented, so it is only the control the claim needs if the media
    // itself never stalled. Without this the numbers would also be produced by
    // a video that stopped, and "the player repaints without the callback"
    // would be resting on a paused video that happens to be cheap to draw.
    const advanced = await page.evaluate(async () => {
      const video = document.querySelector<HTMLVideoElement>(
        "[data-yunari-background-media] video",
      );
      if (video === null)
        throw new Error("the background video is not mounted");
      const before = video.currentTime;
      await new Promise((done) => setTimeout(done, 1000));
      return {
        advanced: video.currentTime - before,
        paused: video.paused,
      };
    });
    expect(advanced.paused, "the background video is still playing").toBe(
      false,
    );
    expect(
      advanced.advanced,
      "and its clock is still moving, so the withheld frames are real",
    ).toBeGreaterThan(0);
    expect(
      idle.withheld,
      "the browser kept presenting frames the page then withheld",
    ).toBeGreaterThan(4);
    expect(
      idle.delivered,
      "and the product's chain ended, so nothing was delivered in this window",
    ).toBe(0);
    // **The claim.** The display keeps repainting on its own cadence, so the
    // render count does not collapse to the frames' — it falls back to the
    // loop's. **The two counts are not the same kind of number**: this page is
    // served to loopback, which resolves to the machine's own display, whose
    // rate is 1 fps by default (`chartFpsFor`), while phase A also renders once
    // per delivered video frame (~30/s). Comparing a ratio would measure the
    // video's cadence, not the loop's. Three seconds at 1 fps owes about three
    // renders; `>= 2` is that budget with one window of slack.
    expect(
      idle.renders,
      `the player still repaints with no video frames delivered (${idle.renders} against ${armed.renders} armed)`,
    ).toBeGreaterThanOrEqual(2);
  });
});

test.describe("changing media on the real player", () => {
  test("a playing video background reaches the glass panel over it", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "a decoded video frame and its glass are a desktop read",
    );
    const id = themeId(testInfo.project.name);
    await publish(page, id, await recordWebm(page));

    await page.setViewportSize({ width: 1280, height: 960 });
    await page.goto(`${HOST}/?theme=${id}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    // The player's failure page, not the `<pre>` it used to be: see the control
    // of the same name in `host-player.spec.ts`, which pins the marker.
    await expect(page.locator("[data-yunari-load-failure]")).toHaveCount(0);

    // A video element that never decoded would be an element that exists, which
    // is the failure a `200` cannot see.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const video = document.querySelector<HTMLVideoElement>(
              "[data-yunari-background-media] video",
            );
            return video === null
              ? -1
              : video.readyState * 1000 + video.videoWidth;
          }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(2000);

    // The source the host served, read off the element: the route, the content
    // type and the declared path all have to have been right for this to decode.
    // `.src` is the resolved URL, which is what the browser actually requested;
    // the attribute is the unresolved root-relative form the resolver built.
    const src = await page
      .locator("[data-yunari-background-media] video")
      .evaluate((element) => (element as HTMLVideoElement).src);
    expect(src).toBe(`${HOST}/api/themes/${id}/assets/loop.webm`);

    /**
     * Panel and its source, sampled together and **bracketed**.
     *
     * The video is read before *and* after the panel. The panel is composited
     * from whichever frame the media held at the canvas's last repaint, so a
     * sample taken while the clip is switching states can disagree with the
     * source legitimately. A bracket that changed is that sample, and it is
     * dropped rather than scored as a stale panel — which would otherwise make
     * the test fail on the fixture's own cadence instead of on the glass.
     */
    const sample = async (): Promise<{
      before: Awaited<ReturnType<typeof videoDominant>>;
      panel: Awaited<ReturnType<typeof panelInk>>;
      after: Awaited<ReturnType<typeof videoDominant>>;
    }> => {
      const before = await videoDominant(page);
      const panel = await panelInk(page);
      const after = await videoDominant(page);
      return { before, panel, after };
    };

    // Enough samples that the clip's alternation is seen several times over.
    const samples = [await sample()];
    for (let i = 0; i < 9; i += 1) {
      await page.waitForTimeout(200);
      samples.push(await sample());
    }
    const trace = samples
      .map((s) => `${s.before[0]}/${s.panel.dominant[0]}`)
      .join(" ");

    // **The control.** The media really was changing. Without this, a panel
    // that never moved would be indistinguishable from a video that never
    // played, and the assertion below would pass on a still frame.
    const videoStates = new Set(samples.flatMap((s) => [s.before, s.after]));
    expect(
      [...videoStates].sort(),
      `the video's own frames alternated (${trace})`,
    ).toEqual(["blue", "red"]);

    // Samples that span a transition cannot say anything about the glass.
    const steady = samples.filter((s) => s.before === s.after);
    expect(
      steady.length,
      `enough readings landed inside one state (${trace})`,
    ).toBeGreaterThanOrEqual(4);

    // **The claim.** The glass over the media shows the frame that is current,
    // not a still of whichever frame it first sampled. A panel frozen on its
    // first frame agrees on the readings that happen to match it and fails the
    // rest, so the agreement rate is the measurement.
    const agreed = steady.filter((s) => s.panel.dominant === s.before).length;
    expect(
      agreed / steady.length,
      `the panel matched the current frame on ${agreed}/${steady.length} steady readings (${trace})`,
    ).toBeGreaterThan(0.8);

    // And the panel moved *with* it, rather than holding one dominant channel
    // throughout: both states have to appear on the panel side too.
    const panelStates = new Set(steady.map((s) => s.panel.dominant));
    expect(
      [...panelStates].sort(),
      `the panel itself changed dominant channel (${trace})`,
    ).toEqual(["blue", "red"]);

    // The panel is genuinely compositing media, not an empty translucent box.
    for (const s of samples) {
      expect(
        s.panel.opaque,
        "the glass panel painted opaque pixels to composite the media into",
      ).toBeGreaterThan(1000);
    }
  });

  test("swapping the background asset replaces what the display shows", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "counting the replacement's ink is a desktop read",
    );
    const id = themeId(testInfo.project.name);
    await publish(page, id, await recordWebm(page));

    await page.setViewportSize({ width: 1280, height: 960 });
    await page.goto(`${HOST}/?theme=${id}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const video = document.querySelector<HTMLVideoElement>(
              "[data-yunari-background-media] video",
            );
            return video?.readyState ?? -1;
          }),
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(2);

    // The video is running and the badge is not on screen.
    expect(await compositedInk(page, BADGE_INK)).toBeLessThan(200);

    // **The replacement.** Two entries now, because the background is its own
    // state: `updateArtboard` takes the document's geometry (its media is no
    // longer an artboard field), and `updateBackground` takes the authored bag.
    // This is the editor's replacement path reached on the player's mount, so
    // the player's resolver builds the *new* asset's URL and the host serves it.
    const swapped = await page.evaluate(
      async ([panelId, left, top, width, height]) => {
        const handle = (
          window as unknown as {
            yunari?: {
              handle: {
                updateArtboard(artboard: unknown): void;
                updateBackground(background: unknown): void;
                canvas: { getObjects(): Array<{ get(n: string): unknown }> };
              };
            };
          }
        ).yunari?.handle;
        if (handle === undefined) throw new Error("the player has not mounted");
        handle.updateArtboard({
          width: 640,
          height: 360,
          contentFit: "cover",
        });
        handle.updateBackground({
          color: { ref: "palette.none" },
          media: { assetId: "badge", bounds: "display" },
        });
        const layer = document.querySelector("[data-yunari-background-media]");
        const image = layer?.querySelector("img");
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (image?.complete && image.naturalWidth > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          hasVideo: layer?.querySelector("video") !== null,
          hasImage: image !== null,
          src: image?.src ?? "",
          naturalWidth: image?.naturalWidth ?? 0,
          panelFound: handle.canvas
            .getObjects()
            .some((object) => object.get("id") === panelId),
          panel: [left, top, width, height],
        };
      },
      [PANEL_ID, PANEL.left, PANEL.top, PANEL.width, PANEL.height] as const,
    );

    expect(swapped.hasImage, "the layer now holds an image").toBe(true);
    expect(
      swapped.hasVideo,
      "the video was torn down rather than left behind",
    ).toBe(false);
    expect(swapped.src).toBe(`${HOST}/api/themes/${id}/assets/badge.svg`);
    expect(swapped.naturalWidth, "the replacement asset decoded").toBe(24);
    expect(
      swapped.panelFound,
      "the scene survived the swap rather than remounting",
    ).toBe(true);

    // **The pixels.** The replacement's own ink is on the composited artboard,
    // which is the only place the media layer is visible at all.
    await expect
      .poll(() => compositedInk(page, BADGE_INK), { timeout: 20_000 })
      .toBeGreaterThan(200);
  });
});

/** The first non-loopback IPv4 this machine answers on. The paired half of the
 *  test needs a request the host does not consider loopback, or `allowed()`
 *  short-circuits and the session is never consulted. */
function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal)
        return address.address;
    }
  }
  return undefined;
}

/** A second host, bound so a paired display can reach it. Loopback-only hosts
 *  create no session store at all, so a session cannot be minted against one. */
async function startLanHost(port: number): Promise<ChildProcess> {
  const child = spawn(
    "node",
    [
      "packages/host/bin/yunari.js",
      "--no-browser",
      "--port",
      String(port),
      "--host",
      "0.0.0.0",
      "--app-dir",
      HOST_APP_DIR,
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`the LAN host never answered on ${port}`);
}

test.describe("a paired display fetching a theme asset", () => {
  /** The port is separate from every one Playwright owns, and the themes
   *  directory is the seeded one, so the package under test is the real one. */
  const LAN_PORT = 4182;

  test("serves the declared asset to a paired peer and refuses an unpaired one", async ({
    request,
  }) => {
    const lan = lanAddress();
    test.skip(
      lan === undefined,
      "this machine has no non-loopback IPv4 address for a LAN peer",
    );

    const host = await startLanHost(LAN_PORT);
    try {
      // Minting is loopback-only by design; the phone only ever holds the
      // credential, which the route answers once beside the display it belongs to.
      const minted = await request.post(
        `http://127.0.0.1:${LAN_PORT}/api/pairing/sessions?label=e2e`,
      );
      expect(minted.status()).toBe(201);
      const token = ((await minted.json()) as { token: string }).token;

      // The route and the content type the asset URL depends on, from an
      // address the host does not treat as its own.
      const asset = `/api/themes/e2e-media/assets/badge.svg`;
      const unpaired = await request.get(`http://${lan}:${LAN_PORT}${asset}`);
      expect(
        unpaired.status(),
        "an unpaired peer is refused the theme's bytes",
      ).toBe(403);

      // By query, because that is the form a `<img>`/`<video>` src can carry.
      const paired = await request.get(
        `http://${lan}:${LAN_PORT}${asset}?session=${encodeURIComponent(token)}`,
      );
      expect(paired.status(), "a paired peer is served the asset").toBe(200);
      expect(
        paired.headers()["content-type"],
        "served as its own type, or no browser will decode it",
      ).toBe("image/svg+xml");
      expect(await paired.text()).toContain("<svg");

      // The token placement 75bff56 fixed: a query belongs at the end of the
      // URL, so the declared path has to arrive whole ahead of it. The
      // pre-fix shape appended the path *after* the query and 404s.
      const malformed = await request.get(
        `http://${lan}:${LAN_PORT}/api/themes/e2e-media/?session=${encodeURIComponent(token)}assets/badge.svg`,
      );
      expect(
        malformed.status(),
        "the pre-fix URL shape really does fail, so the passing one is not a coincidence",
      ).not.toBe(200);
    } finally {
      host.kill();
    }
  });

  test("a paired display's own player puts the token after the asset path", async ({
    page,
  }) => {
    // **The player's own resolver, measured in a browser.** The other test in
    // this block proves the host answers a paired peer; this proves the player
    // *asks* in the form the host answers, which is the half `75bff56` changed
    // and which no test had measured.
    //
    // It runs over loopback on purpose. The URL the player builds is a property
    // of `createAssetResolver` and `withToken`, not of the network, and loopback
    // is the only way to read that URL out of a live player without the display
    // having to boot from the LAN — where the bundle itself is served, and the
    // host refuses it to an unpaired address. Asserting the shape on loopback
    // is the same assertion; going through a LAN host would add a second
    // variable, not more evidence.
    const session = "paired-display-token";
    await page.goto(`${HOST}/?theme=e2e-media&session=${session}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect
      .poll(() => decodedInk(page), { timeout: 20_000 })
      .toBeGreaterThan(200);

    const src = await page
      .locator("[data-yunari-background-media] img")
      .evaluate((element) => (element as HTMLImageElement).src);

    // The declared path arrives whole, ahead of the query. Reverting the fix
    // produces `…/e2e-media/?session=<token>assets/badge.svg` — measured, not
    // assumed — which no route matches and no image decodes.
    expect(
      src,
      "the session token rides the finished URL, after the declared path",
    ).toBe(`${HOST}/api/themes/e2e-media/assets/badge.svg?session=${session}`);

    // The path must not have been folded into the query, which is the shape the
    // pre-fix code produced. Stated separately so a failure names the defect.
    const query = src.slice(src.indexOf("?"));
    expect(query, "nothing but the token is in the query string").toBe(
      `?session=${session}`,
    );
  });
});
