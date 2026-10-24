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

/** `/path` yes; a scheme, an authority or a bare relative name no. */
export function isHostRelativeImageUrl(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !hasUnsafeCharacter(value)
  );
}

/**
 * A URL parser strips tab, newline and CR before it reads the authority, and
 * treats a backslash as `/` — so `/\n/evil.example/x` names an origin while the
 * first character is a slash. Every C0 control, DEL and backslash is refused.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The binding id an image reading is written under (see the image inspector). */
const IMAGE_BINDING_ID = "image";

/** What the document authored, kept per object so a lost reading restores it. */
const authoredSources = new WeakMap<FabricObject, string>();
/** The reading URL currently applied, so the refresh cadence reloads nothing. */
const appliedSources = new WeakMap<FabricObject, string>();
/** The newest load per object; an older one that lands late is discarded. */
const generations = new WeakMap<FabricObject, number>();

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
    // `textValue` on a sample proves nothing about the binding it arrived
    // through, so only the binding the inspector writes is an image reading.
    const binding = bindings[nodeId]?.find(
      (entry) => entry.id === IMAGE_BINDING_ID,
    );
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
    load(object, nodeId, url, hooks);
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
  load(object, nodeId, authored, hooks);
}

/**
 * Fabric's own load path is a promise with no error channel; this one reports.
 *
 * Loads settle in network order, not in the order they were asked for, so each
 * one takes a generation and only the newest may reach the object. Without that,
 * a slow earlier reading landing after a later one leaves the wrong picture on
 * screen for the life of the display — and `appliedSources` would refuse to
 * correct it.
 */
function load(
  object: FabricImage,
  nodeId: string,
  src: string,
  hooks: ImageBindingHooks,
): void {
  const generation = (generations.get(object) ?? 0) + 1;
  generations.set(object, generation);

  const element = document.createElement("img");
  element.alt = "";
  element.addEventListener("load", () => {
    if (generations.get(object) !== generation) return;
    object.setElement(element);
    object.set("dirty", true);
  });
  element.addEventListener("error", () => {
    if (generations.get(object) !== generation) return;
    hooks.onLoadError?.(nodeId);
  });
  element.src = src;
}
