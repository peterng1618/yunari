// @vitest-environment jsdom

/**
 * A card the theme cannot express, through each surface that offers one.
 *
 * **Reachable, not theoretical.** On a blank theme (`File > New`) the palette
 * carries ten tokens and the cards name `palette.cpu`, `palette.gpu`,
 * `palette.ram`, `palette.vram`, `palette.down`, `palette.sparkArea` and
 * `palette.storageFill` — so only Clock survives. The author inserts a `CPU`
 * card, and before this was fixed **nothing happened, nothing was said**, and an
 * unhandled rejection went to the console.
 *
 * The cause was a per-surface one, which is why this drives every surface rather
 * than one: the Add pane wrapped the promise in `constructing`, which reported
 * it, and the canvas context menu dispatched through a façade typed
 * `insertCard(cardId): void`, which **discarded** the rejecting promise. One of
 * two surfaces swallowed the refusal. That surface list was three until the
 * header's Insert menu was deleted (§7.1: Insert lives in the Add pane), which
 * removed one swallowed refusal rather than one case.
 *
 * Every surface here is the real one — the real panel, the real context menu —
 * against a real `EditorSession` on a blank theme, so this fails if any surface
 * stops reaching the owner or the owner stops reporting.
 */
import { Canvas } from "fabric/es";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { artboardSize } from "./artboard-presets.js";
import { AssetManager } from "./asset-manager/index.js";
import { createClipboardManager } from "./clipboard-manager/index.js";
import { createDeletionManager } from "./deletion-manager/index.js";
import { EditorSession } from "./editor-session.js";
import type { EditorShellBridge } from "./editor-shell/bridge.js";
import { createEditorShellBridge } from "./editor-shell/bridge.js";
import { CanvasContextMenu } from "./editor-shell/canvas-context-menu.js";
import { createErrorManager } from "./error-manager/index.js";
import { createBlankFabricTheme } from "./new-fabric-theme.js";
import { createNewObjectPanel } from "./new-object-panel.js";
import { idleCrop } from "./selection-inspector/idle-crop.test-stage.js";
import type { TextPlacementPort } from "./text-manager/index.js";
import { uiCopy } from "./ui-copy.js";

// Base UI's popup needs two browser APIs jsdom has none of: floating-ui observes
// its anchor, and the popup waits for its own open transition before reporting
// itself open. Without them the canvas context menu never mounts.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];

// jsdom's selector engine cannot answer `:modal`/`:popover-open`, and
// floating-ui asks for both on every position. Each unanswerable call costs
// ~0.5s of selector parsing, which turns one menu open into ~35s. Real browsers
// answer both.
beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

/**
 * What the author was told. `createErrorManager` fires `editor:warning` on the
 * canvas, and that is the event the shell's diagnostic surface renders — so
 * this reads the real message rather than a stub's return value.
 */
const told: string[] = [];

/** The palette of `File > New`: ten tokens, none of them a device's colour. */
const BLANK = createBlankFabricTheme(
  artboardSize("16:9", "1080p", "landscape"),
);

/** The same theme with no palette at all: the bare case `vg-484` names, where
 *  every construction refuses before it builds anything. */
const BARE = { ...BLANK, globals: { ...BLANK.globals, palette: {} } };

/** React schedules outside `act`, and floating-ui's measurement never settles
 * inside one, so a popup is flushed with macrotasks instead. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Wired {
  readonly session: EditorSession;
  readonly facade: ReturnType<EditorSession["actionFacade"]>;
  readonly errors: ReturnType<typeof createErrorManager>;
  readonly canvas: Canvas;
  /** The placement port the text route armed, played by a test to end the
   *  gesture the way a click would. */
  readonly port: () => TextPlacementPort | undefined;
}

/** A real session on a real blank theme, over a real Fabric canvas. */
function wiredSession(envelope: typeof BLANK = BLANK): Wired {
  const element = document.createElement("canvas");
  element.width = 1920;
  element.height = 1080;
  document.body.append(element);
  const canvas = new Canvas(element);
  const errors = createErrorManager(canvas);
  // The editor's own diagnostics, read as the shell's diagnostic surface reads
  // them: `createErrorManager` fires `editor:warning` on the canvas.
  canvas.on(
    "editor:warning" as never,
    ((event: { message: string }) => {
      told.push(event.message);
    }) as never,
  );
  const save = vi.fn();
  /** The one placement port the session's text route arms. */
  let armed: TextPlacementPort | undefined;

  const session = new EditorSession({
    assetManager: new AssetManager(),
    shell: {
      editor: {
        canvas,
        errorManager: errors,
        clipboardManager: createClipboardManager({
          canvas,
          save,
          errors,
          deletion: createDeletionManager(canvas, save),
          importImage: vi.fn(async () => null),
        }),
        textManager: {
          addText: vi.fn(),
          beginPlacement: (port: TextPlacementPort) => {
            armed = port;
          },
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        viewport: {
          zoom: () => 1,
          display: () => undefined,
          isFitted: () => false,
          onChange: () => () => undefined,
        },
        artboard: () => ({ width: 1920, height: 1080 }),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input: unknown) => input),
      setBackgroundMedia: vi.fn(),
    } as never,
    source: {} as never,
    envelope,
    panelHosts: {
      add: document.body,
      assets: document.body,
      tokens: document.body,
      document: document.body,
      selection: document.body,
    },
    onNew: vi.fn(),
    onNewFromStarter: vi.fn(),
    onSaved: vi.fn(),
  });
  return {
    session,
    facade: session.actionFacade(),
    errors,
    canvas,
    port: () => armed,
  };
}

beforeEach(() => {
  told.length = 0;
  document.body.replaceChildren();
});

/**
 * A theme whose palette is not the starter's.
 *
 * `vg-128`, and the finding that made it a design question rather than a bug.
 * This is the **blank theme** — `File > New`, ten tokens, none of them a
 * device's colour — and it is where the ruling bites hardest: **seven of the
 * eight cards used to be refused here**, because refusing is what kept an
 * unresolved reference out of a document that `snapshot` validates and throws
 * on. The refusal was safe and it was unusable, and the library was dead exactly
 * where an author meets it first.
 *
 * So a blank theme now *inserts*, and says what it mapped. The refusal survives
 * for the theme that genuinely cannot express a card at all, which is a
 * document with no palette to build from — the Add pane's own rule, and pinned
 * below through the same two surfaces an author can reach.
 */
describe("a card a theme with its own vocabulary cannot name", () => {
  it("is inserted and mapped, and the author is told, from the Add pane", async () => {
    const { session, errors, canvas } = wiredSession();
    const panel = createNewObjectPanel(
      document.body,
      editorOf(canvas, errors),
      {
        palette: BLANK.globals?.palette ?? {},
        typePresets: BLANK.globals?.typePresets ?? {},
      },
      {
        addText: vi.fn(),
        addChart: vi.fn(),
        insertCard: (cardId) => session.actionFacade().insertCard(cardId),
      },
    );

    const cpu = [...panel.root.querySelectorAll("button")].find(
      (button) => button.textContent === uiCopy.cardLibrary.cpu,
    );
    cpu?.click();
    await flush();

    // **Both halves.** The card is on the canvas, and nothing in it is
    // unresolved: the blank theme has no `palette.cpu`, so the card's icon and
    // sparkline are painted with the content token it does have. Naming the
    // substituted token is what makes that editable rather than surprising.
    expect(canvas.getObjects()).toHaveLength(1);
    expect(told.join(" ")).toContain(uiCopy.cardLibrary.cpu);
    expect(told.join(" ")).toContain("palette.cpu");
    session.destroy();
  });

  it("is inserted and mapped, and the author is told, from the canvas context menu", async () => {
    const { session, canvas } = wiredSession();
    const host = document.createElement("div");
    document.body.append(host);
    canvas.upperCanvasEl.className = "upper-canvas";
    host.append(canvas.upperCanvasEl);

    const root: Root = createRoot(host);
    root.render(
      <CanvasContextMenu bridge={bridgeOf(session.actionFacade(), canvas)} />,
    );
    await flush();
    canvas.upperCanvasEl.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 90,
      }),
    );
    await flush();

    const entry = menuItem(uiCopy.panels.cards, uiCopy.cardLibrary.cpu);
    expect(entry).toBeDefined();
    entry?.click();
    await flush();

    expect(canvas.getObjects()).toHaveLength(1);
    expect(told.join(" ")).toContain("palette.cpu");
    root.unmount();
    session.destroy();
  });
});

/* ---- what the pane does with a construction it cannot reach ---- */

describe("an insert the Add pane cannot reach its owner for", () => {
  it("says so, whichever kind it is, rather than swallowing the click", async () => {
    const { canvas, errors } = wiredSession();
    // **A mis-wired pane, not an empty one.** `actions` is absent: the state a
    // shell would leave an author in by constructing this pane without the
    // session it inserts through. Both buttons are still on screen and still
    // offered, which is why the failure they have to avoid is a silent no-op
    // rather than a dead row. `NewObjectActions` makes both members required and
    // `editor-session.ts` always passes both, so nothing in the product reaches
    // this state today — the case is here because the two paths used to answer
    // it differently.
    //
    // The state the header's Insert menu was gated on is a different one: before
    // a document is open, this pane's host element is empty, so there is no row
    // to offer at all.
    const panel = createNewObjectPanel(
      document.body,
      editorOf(canvas, errors),
      undefined,
    );

    // Scoped to this panel: `wiredSession()` builds the session's own Add pane
    // into `document.body` as well, and that one is wired.
    buttonUnder(panel.root, uiCopy.panels.cards)?.click();
    await flush();
    buttonUnder(panel.root, uiCopy.panels.charts)?.click();
    await flush();

    // Both, because they used to differ: the card path refused by name and the
    // chart path dispatched through `actions?.addChart` and said nothing. A
    // control that quietly does nothing is the one failure an author cannot
    // diagnose, so the two now behave the same way — and this is the assertion
    // that keeps them that way.
    expect(told.join(" ")).toContain("card library");
    expect(told.join(" ")).toContain("chart families");
    expect(canvas.getObjects()).toHaveLength(0);
  });
});

/* ---- a construction the theme cannot express ---- */

/**
 * `vg-484`: a construction dispatched through `bridge.run` reaches the session
 * façade unwrapped, so a refusal was silent from the footer. The row's own bare
 * case is a theme with no usable token — `firstPalette` throws "New objects
 * require a palette token." before any object is built.
 */
describe("a construction the theme cannot express", () => {
  it("is refused in words, from the footer's own route", async () => {
    const { session, facade, errors, canvas, port } = wiredSession(BARE);
    const bridge = createEditorShellBridge({
      editor: editorOf(canvas, errors),
      session: facade,
      capture: () => undefined,
    } as never);

    bridge.run("new-text");
    await flush();
    // The footer arms; the pointer ends the gesture. A refusal is the gesture's
    // outcome, so it is reported when the placement is attempted.
    port()?.onPlace({ left: 10, top: 10 });
    await flush();

    expect(told.join(" ")).toContain("palette token");
    expect(canvas.getObjects()).toHaveLength(0);
    bridge.destroy();
    session.destroy();
  });

  it("is refused in words, from the canvas context menu's own route", async () => {
    // The menu dispatches a construction through the façade's own `addText`
    // (`canvas-context-menu.tsx`'s `creationGroups`), so the two surfaces share
    // one method: this is the second caller, not a second implementation.
    const { session, facade, port } = wiredSession(BARE);

    facade.addText();
    port()?.onPlace({ left: 10, top: 10 });
    await flush();

    expect(told.join(" ")).toContain("palette token");
    session.destroy();
  });
});

/* ---- the surfaces' own wiring, stated once each ---- */

function editorOf(
  canvas: Canvas,
  errors: Wired["errors"],
): Parameters<typeof createNewObjectPanel>[1] {
  return {
    canvas,
    artboard: () => ({ width: 1920, height: 1080 }),
    historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
    textManager: { addText: vi.fn() },
    errorManager: errors,
  } as never;
}

function bridgeOf(
  facade: ReturnType<EditorSession["actionFacade"]>,
  canvas: Canvas,
): EditorShellBridge {
  return {
    snapshot: () => ({
      selectedCount: 0,
      locked: false,
      activeKind: "none",
      documentName: undefined,
      selectionPresetId: undefined,
    }),
    target: () => ({
      kind: "none",
      locked: false,
      memberCount: 0,
      isGroup: false,
    }),
    can: () => false,
    canArrange: () => false,
    layers: () => [],
    groupContext: () => [],
    selectLayer: vi.fn(),
    setLayerVisible: vi.fn(),
    setLayerLocked: vi.fn(),
    setCollapsed: vi.fn(),
    renameLayer: vi.fn(),
    layerDrop: () => undefined,
    moveLayer: () => false,
    subscribe: () => () => undefined,
    run: vi.fn(),
    capture: () => undefined,
    session: facade,
    editor: {
      canvas,
      // Read by the display switch for the group of previews that leads.
      artboard: () => ({ width: 1920, height: 1080 }),
      // The zoom readout subscribes to it, so an absent camera is a throw
      // rather than an exercise of the shell.
      viewport: {
        zoom: () => 1,
        display: () => undefined,
        isFitted: () => false,
        onChange: () => () => undefined,
      },
    } as never,
    destroy: vi.fn(),
  } as unknown as EditorShellBridge;
}

/**
 * The first button under a named group's legend, which is how the pane offers
 * a kind: `uiCopy.panels.charts` heads the chart family buttons. Scoped to one
 * pane, because a session builds its own Add pane beside this one.
 */
function buttonUnder(
  root: HTMLElement,
  label: string,
): HTMLButtonElement | undefined {
  const legend = [...root.querySelectorAll("legend")].find(
    (element) => element.textContent === label,
  );
  return legend?.parentElement?.querySelector("button") ?? undefined;
}

/**
 * The entry under a named group, which is what tells the two "Line"s apart.
 *
 * Read by whichever the surface carries: the canvas context menu names an item
 * with `aria-label`, the Add pane with its own text.
 */
function menuItem(group: string, label: string): HTMLElement | undefined {
  const heading = [
    ...document.body.querySelectorAll<HTMLElement>(".editor-shell-menu-label"),
  ].find((element) => element.textContent === group);
  return [
    ...(heading?.parentElement?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    ) ?? []),
  ].find(
    (item) =>
      item.getAttribute("aria-label") === label || item.textContent === label,
  );
}
