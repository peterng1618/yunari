/**
 * Device groups a theme can ask a host to answer (§145, "device assignments").
 *
 * Shared by the host, which owns the settings, and the editor, which filters the
 * host's `required` list. It lives here because both already depend on this
 * package for the theme vocabulary and neither may depend on the other.
 */
export const ASSIGNABLE_GROUPS = ["gpu", "system-disk", "data-disk"] as const;

export type AssignableGroup = (typeof ASSIGNABLE_GROUPS)[number];
