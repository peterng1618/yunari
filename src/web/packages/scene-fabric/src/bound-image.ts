import type { Binding, SampleSource } from "@yunari/renderer-core";
import { FabricImage, type FabricObject, Group } from "fabric/es";

/**
 * Hydration for images bound to an image reading.
 *
 * The reading is a URL, so it is also the one binding that could make a display
 * fetch an origin nobody authored. A value is accepted only when it is
 * host-relative; anything else is refused and the authored asset stands.
 */

export interface ImageBindingHooks {
  /** Turns the accepted host-relative path into the URL Fabric loads. */
  readonly resolve: (hostRelativeUrl: string) => string | undefined;
  readonly onRefused?: (nodeId: string, reason: string) => void;
  readonly onLoadError?: (nodeId: string) => void;
}

const REFUSED_SAMPLE_URL =
  "an image reading must be a host-relative path, so it was not loaded";

/** `/path` yes; a scheme, an authority or a bare relative name no. A backslash
 *  is refused too: URL parsing treats it as `/`, so `/\host/x` names an
 *  authority while looking like a path. */
export function isHostRelativeImageUrl(value: string): boolean {
  return (
    value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
  );
}

/** What the document authored, kept per object so a lost reading restores it. */
const authoredSources = new WeakMap<FabricObject, string>();
/** The reading URL currently applied, so the refresh cadence reloads nothing. */
const appliedSources = new WeakMap<FabricObject, string>();

/**
 * Applies every image reading to the objects it is bound to. A sample that is
 * missing, unavailable, or not host-relative restores the authored source
 * rather than leaving stale art on the display.
 */
export function refreshBoundImages(
  objects: readonly FabricObject[],
  bindings: Readonly<Record<string, readonly Binding[]>>,
  source: Pick<SampleSource, "latest">,
  hooks: ImageBindingHooks,
): void {
  for (const object of objects) {
    if (object instanceof Group) {
      refreshBoundImages(object.getObjects(), bindings, source, hooks);
      continue;
    }
    if (!(object instanceof FabricImage)) continue;

    const nodeId = object.get("id");
    if (typeof nodeId !== "string" || nodeId.length === 0) continue;
    const binding = bindings[nodeId]?.[0];
    if (binding === undefined) continue;

    const authored = authoredSources.get(object) ?? object.getSrc();
    authoredSources.set(object, authored);

    const sample = source.latest(binding.semanticKey);
    const reading = sample?.status === "ok" ? sample.textValue : undefined;

    if (reading === undefined) {
      restore(object, nodeId, authored, hooks);
      continue;
    }
    if (!isHostRelativeImageUrl(reading)) {
      hooks.onRefused?.(nodeId, REFUSED_SAMPLE_URL);
      restore(object, nodeId, authored, hooks);
      continue;
    }

    const url = hooks.resolve(reading);
    if (url === undefined) {
      restore(object, nodeId, authored, hooks);
      continue;
    }
    if (appliedSources.get(object) === url) continue;

    appliedSources.set(object, url);
    load(object, url, () => hooks.onLoadError?.(nodeId));
  }
}

/** Put the authored source back, once: an unbound or unread image is not a load. */
function restore(
  object: FabricImage,
  nodeId: string,
  authored: string,
  hooks: ImageBindingHooks,
): void {
  if (!appliedSources.has(object)) return;
  appliedSources.delete(object);
  load(object, authored, () => hooks.onLoadError?.(nodeId));
}

/** Fabric's own load path is a promise with no error channel; this one reports. */
function load(object: FabricImage, src: string, onError: () => void): void {
  const element = document.createElement("img");
  element.alt = "";
  element.addEventListener("load", () => {
    object.setElement(element);
    object.set("dirty", true);
  });
  element.addEventListener("error", onError);
  element.src = src;
}
