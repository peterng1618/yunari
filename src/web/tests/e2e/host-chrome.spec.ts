import { expect, type Page, test } from "@playwright/test";
import {
  HOST_MISSING_THEME_ID,
  HOST_PORT,
  HOST_THEME_ID,
} from "./host-theme.js";

/**
 * The display's own chrome, on the real host.
 *
 * This measures the strip against the surface a reader actually gets: a theme
 * package the host served, a real transport that can be broken, and the mount
 * path `vite preview` cannot exercise. The preview-bundle twin this file once
 * paired with went with the player's `?theme=` fixture path; the strip's own
 * behaviour is unit-tested in `packages/player/src/chrome.dom.test.ts`.
 *
 * The three tests are the shapes only that surface speaks for — a strip
 * raised *after* the first fit, a broken transport, and a healthy stream that
 * should say nothing at all.
 */

const PHONE = {
  portrait: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
} as const;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface ChromeGeometry {
  readonly host: Box;
  readonly strips: readonly { readonly id: string; readonly box: Box }[];
  readonly painted: Box;
  readonly degenerate: boolean;
}

async function chromeGeometry(
  page: Page,
  artboard: { readonly width: number; readonly height: number },
): Promise<ChromeGeometry> {
  return page.evaluate((size) => {
    const box = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    };
    const host = document.querySelector<HTMLElement>("#artboard");
    if (host === null) throw new Error("the display has no artboard host");
    const handle = (
      window as unknown as {
        yunari?: {
          handle?: {
            transform(): {
              scale: number;
              offsetX: number;
              offsetY: number;
              isDegenerate: boolean;
            };
          };
        };
      }
    ).yunari?.handle;
    const transform = handle?.transform();
    if (transform === undefined) throw new Error("the display has no scene");

    const hostBox = box(host);
    return {
      host: hostBox,
      strips: [
        ...document.querySelectorAll<HTMLElement>("[data-yunari-chrome-strip]"),
      ].map((strip) => ({ id: strip.id, box: box(strip) })),
      // The transform's offsets are relative to the host, the rects are not.
      painted: {
        x: hostBox.x + transform.offsetX,
        y: hostBox.y + transform.offsetY,
        w: size.width * transform.scale,
        h: size.height * transform.scale,
      },
      degenerate: transform.isDegenerate,
    };
  }, artboard);
}

/** Area shared by two boxes, in square CSS pixels. */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

const HOST = `http://127.0.0.1:${HOST_PORT}`;

test("a notice that arrives after the fit clears itself without moving the composition", async ({
  page,
}) => {
  // The availability strip is raised from the refresh cadence, not at mount
  // (`main.ts:156-179`), so on a real display the first fit happens with no
  // chrome. This is that display: its only binding is a key no provider on this
  // PC reports.
  //
  // **The fit must not change when it appears or when it goes** (vg-028,
  // measured and ruled 2026-10-14). A strip in flow takes its room from the
  // artboard, the scene's `ResizeObserver` re-fits, and the whole composition
  // moves 16-25px as the notice arrives and back as it leaves — read off the
  // built display's own pixels at 1920x1080. A transport or availability notice
  // can flash on any reconnect, so it overlays its edge instead: the host keeps
  // the viewport's height and the notice covers the artboard while it is up.
  //
  // **And it clears itself three seconds later** (vg-569, asked by the user on
  // 2026-10-17). The dismissal is runtime chrome only: the refresh loop keeps
  // re-saying the same gap at the frame rate, so the warning goes up once, is
  // gone by the time the reader has read it, and stays down while the gap
  // persists. Both halves are read here, because "the composition did not move"
  // is only a claim worth making while the strip is actually there and again
  // once it is not.
  //
  // `&data=live` is load-bearing: the demo source fabricates a reading for
  // every key it is asked for, and the availability notice is raised on the
  // live path only.
  await page.setViewportSize(PHONE.landscape);
  await page.goto(`${HOST}/?theme=${HOST_MISSING_THEME_ID}&data=live`);
  await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

  await expect(page.locator("[data-yunari-availability]")).toBeVisible({
    timeout: 30_000,
  });

  const raised = await chromeGeometry(page, { width: 640, height: 360 });
  // The whole viewport, exactly as a display with nothing to say gets it: a
  // fit that moved here is the slide the author reported.
  expect([raised.host.w, raised.host.h]).toEqual([
    PHONE.landscape.width,
    PHONE.landscape.height,
  ]);

  const [strip] = raised.strips;
  if (strip === undefined) throw new Error("the notice was not drawn");
  expect(strip.id).toBe("yunari-availability");
  // At the display's top edge, over the artboard rather than beside it.
  expect(strip.box.y).toBe(0);
  expect(overlap(strip.box, raised.painted)).toBeGreaterThan(0);

  await expect(page.locator("[data-yunari-availability]")).toHaveCount(0, {
    timeout: 15_000,
  });
  const cleared = await chromeGeometry(page, { width: 640, height: 360 });
  // The same box, to the pixel: the strip overlaid rather than taking room, so
  // clearing it is not a re-fit and the ink has not moved.
  expect(cleared.host).toEqual(raised.host);
  expect(cleared.painted).toEqual(raised.painted);
  // And nothing took its place: this display has no other gap to report.
  expect(cleared.strips).toHaveLength(0);
  // The reading itself, so the two boxes are numbers in the report rather than
  // only an equality between them.
  test.info().annotations.push({
    type: "measured",
    description: `host ${JSON.stringify(cleared.host)} painted ${JSON.stringify(cleared.painted)}`,
  });
});

test("a refused transport leaves the whole phone to the artboard", async ({
  page,
}) => {
  // **The ceiling's case, and the one that would catch a strip laid out in the
  // band.** It was built on a pair — a composition gap and a transport gap —
  // and the composition half is gone (`vg-578`): the
  // crop strip was the last one that took room, so every strip a display can
  // raise now overlays. What is left to assert is the stronger claim the pair
  // was there to make, that a notice costs the composition nothing at all.
  //
  // The pair's other half is still worth recording: a *data* gap can never sit
  // beside a refused transport, because `showAvailabilityNotice` runs on the
  // refresh cadence and a refused socket never delivers a batch, so every key is
  // `undefined` and the notice is silent by design (`availability-notice.ts`).
  await page.route(/\/ws(\?|$)/, (route) => route.abort());
  await page.setViewportSize(PHONE.portrait);
  await page.goto(`${HOST}/?theme=${HOST_THEME_ID}&data=live`);

  await expect(page.locator("#yunari-connection")).toBeVisible({
    timeout: 30_000,
  });

  const geometry = await chromeGeometry(page, { width: 640, height: 360 });

  expect(geometry.strips.map((strip) => strip.id)).toEqual([
    "yunari-connection",
  ]);
  expect(geometry.degenerate).toBe(false);
  // The whole phone, to the pixel: the notice is fixed to the display's edge
  // rather than laid out in a band, so it takes no room from the artboard
  // (vg-028). Measured on the built display before this, a strip in flow cost
  // 46px of a 390px-wide phone — the number this assertion replaces.
  expect([geometry.host.w, geometry.host.h]).toEqual([
    PHONE.portrait.width,
    PHONE.portrait.height,
  ]);
  // And the artboard was refitted to what is left, not merely drawn smaller:
  // `contain` fills the host on one axis.
  expect(
    Math.abs(geometry.painted.w - geometry.host.w) < 0.5 ||
      Math.abs(geometry.painted.h - geometry.host.h) < 0.5,
    "the artboard was not refitted to the box the chrome left it",
  ).toBe(true);
  // The notice sits on the display's own bottom edge, inside the box the
  // artboard was given. That is the shape a band in flow cannot take: laid out
  // in a row the strip would be *below* the host, and the host would have ended
  // where the band began — which is exactly what the pair's crop half did, at
  // `host.h = 844 - 45.59` (`vg-028`).
  //
  // The transport notice is not asserted to overlap the artboard, because at
  // this size it cannot: a 16:9 artboard on a 390x844 phone is letterboxed to
  // 219px and centred, so the painted box ends 284px above the strip. The
  // availability notice in the test above is drawn at the *top* edge, which is
  // why that one does overlap.
  const connection = geometry.strips[0]?.box;
  if (connection === undefined) throw new Error("the notice was not drawn");
  expect(
    Math.abs(connection.y + connection.h - (geometry.host.y + geometry.host.h)),
  ).toBeLessThan(1);
  expect(Math.abs(connection.w - geometry.host.w)).toBeLessThan(1);
});

test("a display with nothing to say is a display unchanged", async ({
  page,
}) => {
  // The compatibility claim, on the surface that matters: a healthy stream and
  // a theme whose objects are inside its artboard. The connection strip is
  // drawn at mount and removed when the stream goes live, so this waits for it
  // — and then reads the fit, because the artboard has to grow back into the
  // room the strip was holding.
  for (const viewport of [PHONE.portrait, PHONE.landscape]) {
    await page.setViewportSize(viewport);
    await page.goto(`${HOST}/?theme=${HOST_THEME_ID}&data=live`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 20_000,
    });

    await expect
      .poll(
        async () => {
          const geometry = await chromeGeometry(page, {
            width: 640,
            height: 360,
          });
          return [geometry.host.w, geometry.host.h, geometry.strips.length];
        },
        { timeout: 10_000 },
      )
      .toEqual([viewport.width, viewport.height, 0]);
  }
});
