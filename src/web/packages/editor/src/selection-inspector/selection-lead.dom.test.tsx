// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectActionId } from "../object-actions.js";
import { uiCopy } from "../ui-copy.js";
import { click } from "./runs.test-stage.js";
import {
  type ArrangeButtonView,
  createSelectionLeadRoot,
  type SelectionLeadView,
} from "./selection-lead.js";

/**
 * The block that leads the column: the arrange actions (`vg-463`).
 *
 * The contract this file can see is the one the value walk cannot: the block
 * decides no eligibility — it draws exactly the buttons it is handed, and greys
 * the ones the view disabled — and its one way to act is the port it was
 * published with.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

function mount(): {
  readonly host: HTMLElement;
  readonly root: ReturnType<typeof createSelectionLeadRoot>;
} {
  const host = document.createElement("div");
  // Attached: a control that is never in the document cannot take a click in the
  // way a person gives one.
  document.body.append(host);
  return { host, root: createSelectionLeadRoot(host) };
}

/** A view of one arrange action per flag: the first `enabled` of them live. */
function arrangeView(
  ...enabled: readonly boolean[]
): readonly ArrangeButtonView[] {
  const verbs = Object.keys(
    uiCopy.arrangeLabels,
  ) as (keyof typeof uiCopy.arrangeLabels)[];
  return enabled.map((live, index) => {
    const verb = verbs[index % verbs.length]!;
    return {
      id: `arrange:${verb}`,
      label: uiCopy.arrangeLabels[verb],
      enabled: live,
    };
  });
}

const arrangeButtons = (host: HTMLElement): readonly HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>("[data-yunari-arrange-action]"),
];

const publish = (
  root: ReturnType<typeof createSelectionLeadRoot>,
  view: SelectionLeadView,
  run: (id: ObjectActionId) => void = () => undefined,
): void => root.publish(view, run);

describe("createSelectionLeadRoot", () => {
  it("renders nothing at all for a selection with no action", () => {
    const { host, root } = mount();

    publish(root, { arrange: [] });

    // Not an empty row: one object has no arrange question, so the block is
    // absent rather than drawn blank. The block's own edge goes with it — a
    // rule with nothing between it and the subject's own would be the boundary
    // this component exists to place, drawn twice.
    expect(host.querySelector("[data-yunari-selection-lead]")).toBeNull();
    expect(host.innerHTML).toBe("");
    expect(host.querySelector("[data-yunari-arrange-row]")).toBeNull();
    root.destroy();
  });

  it("closes with its own edge, since the sections draw none under it", () => {
    const { host, root } = mount();

    publish(root, { arrange: arrangeView(true) });

    // The boundary between this block and the sections is this block's: the
    // first section suppresses its `border-t` when it follows the subject's
    // hairline (`vg-466`), so a lead with no rule of its own would leave the
    // actions and the first section sharing a band. jsdom has no cascade, so
    // what is read is the declaration the class names — which is the part a
    // second component could take away from here without noticing.
    const block = host.querySelector("[data-yunari-selection-lead]");
    expect(block?.className).toContain("border-b");
    expect(block?.className).toContain("border-edge");
    // And the block is the one that carries the row, so a case that moves the
    // rule elsewhere has to move it out of the element they share.
    const row = host.querySelector("[data-yunari-arrange-row]");
    expect(row?.parentElement).toBe(block);
    root.destroy();
  });

  it("runs the action it was given, by the registry's own id", async () => {
    const { host, root } = mount();
    const run = vi.fn();
    const arrange = arrangeView(true, false);

    publish(root, { arrange }, run);

    const [live, greyed] = arrangeButtons(host);
    await click(live!);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(arrange[0]!.id);

    // A disabled control does nothing: the view said this selection cannot run
    // it, and the control's own state is what holds, not the pointer's aim.
    await click(greyed!);
    expect(run).toHaveBeenCalledTimes(1);
    root.destroy();
  });

  it("replaces what it drew on the next publish", () => {
    const { host, root } = mount();

    publish(root, { arrange: arrangeView(true) });
    expect(arrangeButtons(host)).toHaveLength(1);

    publish(root, { arrange: [] });

    expect(arrangeButtons(host)).toHaveLength(0);
    expect(host.querySelector("[data-yunari-selection-lead]")).toBeNull();
    root.destroy();
  });
});
