import type { ScenePlan } from "@yunari/renderer-core";

/** A plan with the artboard values a case names and nothing else, so a case
 *  reads as the one thing it is about. */
export function plan(artboard: Partial<ScenePlan["artboard"]> = {}): ScenePlan {
  return {
    artboard: {
      width: 400,
      height: 300,
      contentFit: "contain",
      background: "#000",
      ...artboard,
    },
    nodes: [],
    issues: [],
  };
}

/** A mounted host with a measurable 400x300 size, which jsdom otherwise has
 *  none of: every fit reads `clientWidth`/`clientHeight`. */
export function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: 300,
  });
  document.body.append(element);
  return element;
}

/** The host's measurable size, which is all `resize()` reads to decide whether
 *  it has anything to do. */
export function resizeHost(
  element: HTMLElement,
  width: number,
  height: number,
): void {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
}
