import type { PluginManifest } from "@yunari/extension-api";

/**
 * Hardware access cannot be self-served: a plugin that drives a USB or serial
 * device enters the owner's review queue before `published`, whatever the
 * author's verification. The manifest is the only input — the package's own
 * validated bytes, never a submission's claim about them.
 */
export function requiresHardwareReview(manifest: PluginManifest): boolean {
  return (
    manifest.contributes.panelFamilies !== undefined ||
    manifest.capabilities.includes("usb:device") ||
    manifest.capabilities.includes("serial:device")
  );
}

/** The review state a freshly finalized version starts in. */
export function reviewStateFor(manifest: PluginManifest): "none" | "pending" {
  return requiresHardwareReview(manifest) ? "pending" : "none";
}
