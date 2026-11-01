import type { FabricThemeEnvelope } from "@yunari/renderer-core";

/**
 * The role tokens every fixture document must carry.
 *
 * `writeThemePackage` and the editor's own validator refuse a document without
 * `heading`, `body` and `mono` (a role is a token id). A fixture written to
 * exercise a palette, a glass shape or an artboard property has no opinion
 * about type, so it states the minimum bag here rather than restating it per
 * spec — and a fixture that does own its tokens keeps them.
 */
export const ROLE_TOKENS = {
  heading: { family: "system-ui, sans-serif", weight: "600" },
  body: { family: "system-ui, sans-serif", weight: "400" },
  mono: { family: "ui-monospace, monospace", weight: "400" },
} as const;

/** `envelope` with the role tokens filled in where it declares none, or only
 *  some: `writeThemePackage` refuses a partial bag the same way it refuses an
 *  absent one. */
export function withRoleTokens(
  envelope: FabricThemeEnvelope,
): FabricThemeEnvelope {
  const globals =
    typeof envelope.globals === "object" && envelope.globals !== null
      ? (envelope.globals as Record<string, unknown>)
      : {};
  const typeTokens =
    typeof globals["typeTokens"] === "object" && globals["typeTokens"] !== null
      ? (globals["typeTokens"] as Record<string, unknown>)
      : {};

  return {
    ...envelope,
    globals: { ...globals, typeTokens: { ...ROLE_TOKENS, ...typeTokens } },
  };
}
