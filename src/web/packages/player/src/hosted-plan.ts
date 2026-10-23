import {
  type FabricThemeEnvelope,
  type PlanIssue,
  planArtboard,
  type ScenePlan,
} from "@yunari/renderer-core";

/**
 * The plan a hosted envelope mounts from.
 *
 * The nodes are empty because this path revives the envelope's own Fabric scene
 * rather than rebuilding a document, so the artboard is the whole plan. Its
 * paints go through renderer-core's resolver all the same: a hosted envelope
 * authors them as palette references, and a reference passed through unresolved
 * paints nothing.
 */
export function envelopePlan(theme: FabricThemeEnvelope): ScenePlan {
  const issues: PlanIssue[] = [];

  return {
    artboard: planArtboard(
      theme.artboard,
      theme.background,
      theme.globals ?? {},
      issues,
    ),
    nodes: [],
    issues,
  };
}
