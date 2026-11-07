import type { InstallResult } from "@yunari/extension-api";

/** The review a held update answers with: the plugin it names and every reason
 *  the update policy held it for. */
export type HeldUpdate = NonNullable<InstallResult["held"]>;

/** The shape both install surfaces read off the wire before drawing it. Every
 *  field is a plain string, so nothing in the notice is plugin-supplied markup. */
export function isHeldUpdate(value: unknown): value is HeldUpdate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const reasons = record["reasons"];
  return (
    typeof record["key"] === "string" &&
    typeof record["name"] === "string" &&
    typeof record["publisher"] === "string" &&
    Array.isArray(reasons) &&
    reasons.every((reason) => typeof reason === "string")
  );
}
