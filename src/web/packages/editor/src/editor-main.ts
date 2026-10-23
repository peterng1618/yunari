import {
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
} from "@yunari/renderer-core";
import {
  assertFabricThemeEnvelopeCompatible,
  type ChartRefreshRate,
  loadFontAssets,
  startChartRefresh,
} from "@yunari/scene-fabric";
import { AssetManager } from "./asset-manager/index.js";
import { EditorSession } from "./editor-session.js";
import {
  createEditorShellBridge,
  documentNameOf,
  type EditorShellBridge,
  openedStatusText,
} from "./editor-shell/bridge.js";
import type { EditorViewControls } from "./editor-shell/session-facade.js";
import { createShellLayout, readStorage } from "./editor-shell/shell-layout.js";
import { mountEditorShell } from "./editor-shell.js";
import "./editor-shell/editor-shell.css";
import { type BootThemeOutcome, bootTheme } from "./boot-theme.js";
import { confirmDraftRecovery } from "./draft-recovery-prompt.js";
import {
  bindDraftAutosave,
  type DraftSource,
  DraftStore,
  startDraftAutosave,
} from "./draft-store.js";
import { createFavoritesClient } from "./favorites-client.js";
import { createEditorSource } from "./live-source.js";
import type { NewDocumentAnswer } from "./new-document-chooser.js";
import {
  createBlankFabricTheme,
  createNewFabricTheme,
} from "./new-fabric-theme.js";
import { createPublisher, type PublishSwitch } from "./publish-client.js";
import { DEFAULT_RUN_DISPLAY_MODE } from "./run-placeholder.js";
import { createSensorCatalogue } from "./sensor-catalogue.js";
import { loadStarterBackdrop } from "./starter-backdrop.js";
import { importThemePackage } from "./theme-import.js";
import { createThemeLibraryClient } from "./theme-library-client.js";
import { captureCanvas } from "./thumbnail-capture.js";
import { uiCopy } from "./ui-copy.js";

type EditorSource = ReturnType<typeof createEditorSource>;
type ActiveEditor = {
  readonly shell: Awaited<ReturnType<typeof mountEditorShell>>;
  readonly extensions: EditorSession;
  readonly releaseFonts: () => void;
  readonly bridge: EditorShellBridge;
  source: EditorSource;
};

async function start(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) {
    throw new Error("Editor shell is missing #app.");
  }

  const libraryClient = createThemeLibraryClient();
  // The author's favourite font trios, which the host keeps in its settings
  // folder. The client reads empty from a host without the store, so a
  // standalone editor still browses the whole catalogue.
  const favoritesClient = createFavoritesClient();
  // The readings the pickers offer: the built-in vocabulary until the host's
  // sensor wire answers. One per editor, so a test can hand in its own and a
  // disconnected editor simply keeps the table.
  const sensors = createSensorCatalogue();
  void sensors.refresh();
  let mode: "preview" | "live" = "preview";
  let active: ActiveEditor | undefined;
  let chartRefreshRate: ChartRefreshRate = 30;

  const layout = createShellLayout(root);
  const host = layout.hosts.canvas;
  const status = layout.hosts.status;
  // The draft: the unsaved document, kept in browser storage so a crash costs
  // the last half-minute of work rather than all of it (`vg-040`). One slot for
  // the whole editor, because the author has one editor, and a browser that
  // refuses its own storage has no draft rather than an error to report.
  const draftStore = new DraftStore(readStorage());
  /** A draft this build could not render, held until the shell that can say so
   *  is mounted. **The status line cannot carry it**: the boot writes that
   *  element last, and the element carries what is open rather than what failed
   *  — the refusal is reported through the shell's own diagnostic line, which
   *  nothing in the boot writes (vg-511). */
  let refusedDraftRestore: string | undefined;
  /** The open document as the autosave asks it. `isDirty` is the session's own,
   *  pulled rather than held, so nothing here re-derives what "saved" means. */
  const draftDocument = (): DraftSource | undefined => {
    if (active === undefined) return undefined;
    const extensions = active.extensions;
    return {
      isDirty: () => extensions.isDirty(),
      draft: () => {
        const content = extensions.snapshot();
        return {
          name: documentNameOf({
            name: content.metadata?.name,
            id: content.id,
          }),
          savedAt: new Date().toISOString(),
          content,
        };
      },
    };
  };
  const autosave = startDraftAutosave({
    store: draftStore,
    document: draftDocument,
  });
  // The page's own lifetime — written on the way out, re-armed on the way back
  // from the back/forward cache — belongs to the autosave, so it is bound where
  // the timer is and can be driven by a test.
  bindDraftAutosave(autosave);
  // A pointer gesture owns the canvas for its duration. The refresh loop runs
  // at 30fps and a full repaint erases Fabric's drag marquee — which is drawn
  // straight onto the context, not into the scene — so the marquee survived
  // about 33ms and then vanished until the pointer moved again. Live readings
  // are not worth showing mid-drag anyway; the next frame after `mouse:up`
  // brings them current.
  //
  // **A panel gesture is deliberately not this guard.** A palette drag reaches
  // the canvas only through the loop: the session hands new globals to six
  // owners and none of them repaints text, so pausing the loop for one would
  // freeze the very preview the drag exists to produce. The loop's cost went
  // down instead — see `LiveRuntime.tick` — rather than away during a gesture.
  const gesture = { down: false };
  const chartRefresh = startChartRefresh(
    () => {
      if (gesture.down) return;
      active?.extensions.tick();
    },
    chartRefreshRate,
    undefined,
    // The session is mounted later, so the report is routed through whatever is
    // current; a throw before one exists is still logged.
    {
      onError: (message) => {
        const manager = active?.shell.editor.errorManager;
        if (manager === undefined) console.warn(`[yunari:repaint] ${message}`);
        else manager.warn("controls", message);
      },
    },
  );
  /** Document actions come from the session once it exists; the View menu's
   * source/refresh controls are owned here and only dispatch through it. */
  const viewControls: EditorViewControls = {
    sourceMode: () => mode,
    setSourceMode: (next) => {
      mode = next;
      replaceSource();
    },
    runDisplay: () =>
      active?.extensions.runDisplay() ?? DEFAULT_RUN_DISPLAY_MODE,
    setRunDisplay: (runMode) => active?.extensions.setRunDisplay(runMode),
    chartRefreshRate: () => chartRefreshRate,
    // The loop is the only owner of cadence: the charts draw when their data
    // moves, so a rate change is a rate change here and nothing downstream.
    setChartRefreshRate: (rate) => {
      chartRefreshRate = rate;
      chartRefresh.setRate(rate);
    },
  };

  const createSource = (envelope: FabricThemeEnvelopeInput): EditorSource =>
    createEditorSource({
      mode,
      keys: semanticKeys(envelope),
      onStatus: (sourceStatus, detail) => {
        const label =
          mode === "preview" ? uiCopy.view.preview : uiCopy.view.live;
        status.textContent = `${label}: ${detail ?? sourceStatus}`;
      },
    });

  /** One publisher for the whole editor: the transport is a fact about this
   *  page, not about which document happens to be open. */
  const publisher = createPublisher({
    onError: (message) => {
      status.textContent = message;
    },
  });
  /** Whether the author has publishing switched on. The publish surface owns
   *  the switch; this owns what the switch does, so a press and a document
   *  change do not have to know about each other. */
  let publishing = false;
  /** Offers whatever is open, or stops. A document the library does not hold
   *  has no folder for a display to fetch its assets from, so the stored theme
   *  stays up rather than one that renders with holes. */
  const offerOpenDocument = (): void => {
    if (!publishing) return;
    const session = active?.bridge.session;
    if (session === undefined) return;

    const document = session.publishableDocument();
    if (document === undefined) {
      void publisher.stop();
      return;
    }
    publisher.offer(document);
  };
  const publish: PublishSwitch = {
    start: () => {
      publishing = true;
      offerOpenDocument();
    },
    stop: async () => {
      publishing = false;
      await publisher.stop();
    },
  };

  const replaceSource = (): void => {
    if (active === undefined) return;
    const source = createSource(active.extensions.envelope);
    active.source.close();
    active.extensions.setSource(source.source);
    active.source = source;
  };

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".yunari-theme";
  picker.hidden = true;
  host.parentElement!.append(picker);

  const mount = async (next: {
    readonly input: FabricThemeEnvelopeInput;
    readonly envelope: FabricThemeEnvelope;
    readonly assets?: Readonly<Record<string, Uint8Array>>;
    readonly thumbnail?: Uint8Array;
    /** The stored document this one came from, when it came from the library.
     *  A new session is built on every mount, so the base has to arrive with
     *  the document rather than be remembered by the one being replaced. */
    readonly base?: string;
    /** Nothing is saved behind this document — a draft restored after a crash.
     *  It reads as unsaved from its first frame, because it is: the work exists
     *  in the editor and in the draft, and nowhere else. */
    readonly unsaved?: boolean;
  }) => {
    assertFabricThemeEnvelopeCompatible(next.envelope);
    const releaseFonts = await loadFontAssets({
      assets: next.envelope.assets ?? [],
      bytes: next.assets ?? {},
      onError: (message) => {
        status.textContent = message;
      },
    });
    const source = createSource(next.input);
    // The shell revives the scene before a session exists, and Fabric enlivens
    // an image from `src` alone. A pasted image's persisted `src` is the dead
    // `blob:` URL of the session that saved it, so without bytes in hand by
    // then the object is not revived broken — it is not revived at all, and the
    // next save drops it. One manager, loaded here where the document and its
    // bytes first meet, and handed to the session rather than a second copy.
    const assetManager = new AssetManager();
    assetManager.load(
      next.envelope.assets === undefined
        ? {}
        : { assets: next.envelope.assets },
      next.assets ?? {},
    );
    let shell: Awaited<ReturnType<typeof mountEditorShell>>;
    try {
      shell = await mountEditorShell({
        host,
        artboard: next.input.artboard,
        envelope: next.envelope,
        resolveSceneAsset: (assetId) => assetManager.previewUrl(assetId),
      });
    } catch (error) {
      assetManager.destroy();
      releaseFonts();
      throw error;
    }
    const options = {
      shell,
      source: source.source,
      envelope: next.input,
      // The package's own picture, so a theme keeps the look its author saw
      // even where this machine cannot render one.
      ...(next.thumbnail === undefined ? {} : { thumbnail: next.thumbnail }),
      ...(next.base === undefined ? {} : { libraryBase: next.base }),
      ...(next.unsaved === true ? { unsaved: true } : {}),
      assetManager,
      panelHosts: {
        add: layout.hosts.add,
        tokens: layout.hosts.tokens,
        document: layout.hosts.document,
        selection: layout.hosts.selection,
      },
      libraryClient,
      favoritesClient,
      sensors,
      onBindingsChange: replaceSource,
      onNew: async (answer: NewDocumentAnswer) => {
        const fresh = createBlankFabricTheme(answer.size);
        await mount({
          input: envelopeInputFor(fresh),
          envelope: fresh,
        });
        // The lens the author answered, asked of the camera the new document is
        // seen through — not written into the document (§67). This runs after
        // the mount because the camera belongs to the shell the mount just
        // built; the previous one is already destroyed. Fit for a Custom answer
        // is `undefined`, the same reading the chooser gives it.
        active?.shell.viewport.showDisplay(answer.display);
        status.textContent = "New theme";
      },
      // The reference composition, reachable as what it is: a template the
      // product ships, not what a new document means.
      onNewFromStarter: async () => {
        const fresh = createNewFabricTheme();
        await mount({
          input: envelopeInputFor(fresh),
          envelope: fresh,
          assets: await starterAssets(),
        });
        status.textContent = "New theme from the starter";
      },
      onImportPackage: () => picker.click(),
      onShowShortcuts: () => layout.showShortcuts(),
      onFindAssets: () => layout.showFinder(),
      onFindFontPicker: () => layout.showFinder("font"),
      // The header's own chord, routed to the control it is printed beside:
      // both open the surface, and the switch inside it is the one owner of
      // whether the host is serving.
      onPublishSurface: () => layout.showPublishing(),
      // The shell's selection projection, so the Tokens pane opens on the
      // preset the selection is set in rather than on the first declared one.
      selection: layout.selection,
      onOpenTheme: async (
        envelope: FabricThemeEnvelope,
        assets: Readonly<Record<string, Uint8Array>>,
        base?: string,
      ) => {
        await mount({
          input: envelopeInputFor(envelope),
          envelope,
          assets,
          ...(base === undefined ? {} : { base }),
        });
        status.textContent = openedStatusText({
          name: envelope.metadata?.name,
          id: envelope.id,
        });
      },
      onSaved: (msg: string | undefined) => {
        // Every save in the editor reports here — the package, the library and
        // the release — so this is the one place the draft is cleared, rather
        // than each of them having to remember. Work the author has kept is not
        // work to recover, and a draft left behind offers to restore it.
        draftStore.clear();
        status.textContent = msg ?? "Theme saved";
      },
      onError: (msg: string) => {
        status.textContent = msg;
      },
    };
    const extensions = new EditorSession(options);
    await extensions.hydrateAssets(shell);
    const bridge = createEditorShellBridge({
      editor: shell.editor,
      session: extensions.actionFacade(),
      // The envelope is the only owner of a binding, so the layer row's bound
      // key is pulled from the live session rather than from the copy this
      // mount opened with — a binding edited afterwards would otherwise leave
      // the row naming a key the document no longer declares.
      bindings: () => extensions.envelope.bindings ?? {},
      // The theme's name is the document's identity; a theme the author has not
      // named is identified by its own id. The schema refuses an empty name and
      // the loader supplies one (`vg-221`), but this reads whatever the document
      // holds, so an empty one is still read as unnamed. The status line takes
      // the same reading (`openedStatusText`), so the two name one document one
      // way.
      documentIdentity: () => ({
        name: extensions.envelope.metadata?.name,
        id: extensions.envelope.id,
        // The release version is the same metadata object the pane reads, so the
        // About tab and the Document pane name one fact from one owner.
        version: extensions.envelope.metadata?.version,
      }),
      capture: () =>
        captureCanvas(
          shell.editor.canvas,
          shell.backdrop(),
          undefined,
          // The bridge's own picture is a read of the document too: the
          // entered-group dim is lifted for it (0053, `vg-527`).
          () => shell.editor.groupingManager.suspendDim(),
        )?.toDataURL("image/png"),
      // The theme's paints, for the Tokens pane's title-bar count (§7.3). The
      // session owns the document, so this is pulled at each snapshot rather
      // than copied: a token added, renamed or deleted moves the number, and
      // `subscribeDocumentChange` is what republishes it.
      palette: () => extensions.envelope.globals?.palette,
    });
    active?.bridge.destroy();
    delete (window as unknown as Record<string, unknown>).yunariEditorBridge;
    active?.extensions.destroy();
    active?.shell.destroy();
    active?.source.close();
    active?.releaseFonts();
    active = { shell, extensions, source, releaseFonts, bridge };
    /** e2e drives a rename through the same bridge the layer panel calls, so the
     * global is published only after the previous document's is torn down. */
    (window as unknown as Record<string, unknown>).yunariEditorBridge = bridge;
    // The document this mount built is what a display follows now; the
    // previous session's listeners were cleared with it.
    bridge.session.subscribeDocumentChange(offerOpenDocument);
    offerOpenDocument();
    layout.setBridge(bridge, viewControls, publish);
    // **After the bridge, and only here.** The diagnostic line is a subscription
    // on this canvas, so the refusal is reported once the mount that replaced
    // the draft has handed the shell its bridge — which is also the first moment
    // there is a shell to report through (vg-511). The draft it names is still
    // in the slot at this point, and is replaced by this document's first edit
    // (`draft-store.ts`).
    if (refusedDraftRestore !== undefined) {
      const message = refusedDraftRestore;
      refusedDraftRestore = undefined;
      shell.editor.errorManager.warn("draft", message);
    }
    // Bound per document, because the canvas is torn down and rebuilt with it.
    const canvas = shell.editor.canvas;
    canvas.on(
      "mouse:down" as never,
      (() => {
        gesture.down = true;
      }) as never,
    );
    canvas.on(
      "mouse:up" as never,
      (() => {
        gesture.down = false;
      }) as never,
    );
  };

  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (file === undefined) return;
    void file.arrayBuffer().then(async (buffer) => {
      // An import is a library write, not a document: the theme lands where it
      // survives the editor closing, and whatever is open stays open.
      const imported = await importThemePackage(new Uint8Array(buffer));
      status.textContent = imported.ok
        ? uiCopy.themeImport.landed(imported.id)
        : uiCopy.themeImport.refused(imported.message);
    });
  });

  // **The page's own lifetime, bound as a pair** (vg-510). `pagehide` is the
  // last event a page gets before it is unloaded or frozen into the
  // back/forward cache; a page restored from that cache comes back with its
  // state intact and no reload, so a stop with no re-arm left the editor with a
  // dead repaint loop and a host told to stop following it. The draft's timer is
  // bound the same way, in `draft-store.ts` (`bindDraftAutosave`).
  window.addEventListener("pagehide", () => {
    chartRefresh.stop();
    // Publishing stops when the author does. The host holds the document in its
    // own memory, so an editor that goes away without saying so leaves a phone
    // showing something nobody is editing any more.
    void publisher.stop();
  });
  // `pageshow` fires on the first load too, so both are no-ops on a fresh page:
  // the loop is already running and nothing has been offered while publishing
  // is off.
  window.addEventListener("pageshow", () => {
    chartRefresh.start();
    offerOpenDocument();
  });
  // The browser owns this dialog's wording and leaves no room to say what would
  // be lost, so it can only ask. It asks the session's own comparison rather
  // than a second one, so a document saved since the last edit stays silent —
  // a warning the author learns to dismiss is the same as no warning.
  window.addEventListener("beforeunload", (event) => {
    if (active?.extensions.isDirty() !== true) return;
    event.preventDefault();
    event.returnValue = "";
  });
  // The draft is offered before anything opens, because the answer decides what
  // opens: restoring mounts the draft in place of the document the boot would
  // have built, where mounting both would load the fonts and the canvas twice
  // and show the author a theme that is about to be replaced.
  const draft = draftStore.read();
  if (draft !== undefined) {
    const answer = await confirmDraftRecovery(draft);
    if (answer === "discard") {
      draftStore.clear();
    } else {
      try {
        await mount({
          input: envelopeInputFor(draft.content),
          envelope: draft.content,
          unsaved: true,
        });
        status.textContent = openedStatusText({
          name: draft.content.metadata?.name,
          id: draft.content.id,
        });
        return;
      } catch (error) {
        // A draft this build cannot render is not a boot failure: the boot opens
        // the document it would have, and the draft survives until the fallback
        // document's first edit takes the slot (`draft-store.ts`). The author is
        // owed the reason and the fate — one slot means the draft that could not
        // be opened here is replaced by the first edit of the one that could —
        // and both are said once the shell exists to say them.
        refusedDraftRestore = `Could not restore the draft "${draft.name}": ${
          error instanceof Error ? error.message : String(error)
        }. Editing this document will replace it.`;
      }
    }
  }
  // A saved theme the author came back to, rather than the reference
  // composition the editor ships. Nothing is open yet, so there is nothing to
  // confirm over; the document this replaces is the one that never opened.
  const requested: BootThemeOutcome = await bootTheme(
    window.location.search,
    libraryClient,
  );
  switch (requested.kind) {
    case "opened": {
      const { content } = requested;
      await mount({
        input: envelopeInputFor(content.envelope),
        envelope: content.envelope,
        assets: content.assets,
        ...(content.base === undefined ? {} : { base: content.base }),
      });
      status.textContent = openedStatusText({
        name: content.envelope.metadata?.name,
        id: content.envelope.id,
      });
      return;
    }
    // A theme the URL named that is stored and does not validate is not a
    // blank success: the author is told why, over the template that stands in
    // for the document they asked for (vg-110, ADR-0043).
    case "invalid": {
      const theme = createNewFabricTheme();
      await mount({
        input: envelopeInputFor(theme),
        envelope: theme,
        assets: await starterAssets(),
      });
      status.textContent = `Could not open the saved theme: ${requested.issues
        .map((issue) => issue.message)
        .join(" ")}`;
      return;
    }
    // A theme the URL named that is stored but past the size the host will read
    // is not a blank success either: the author is told the saved theme is too
    // large to open, over the template that stands in for the document they
    // asked for (vg-409, decisions/0084).
    case "too-large": {
      const theme = createNewFabricTheme();
      await mount({
        input: envelopeInputFor(theme),
        envelope: theme,
        assets: await starterAssets(),
      });
      status.textContent =
        "Could not open the saved theme: it is too large to open.";
      return;
    }
    case "none": {
      const theme = createNewFabricTheme();
      await mount({
        input: envelopeInputFor(theme),
        envelope: theme,
        assets: await starterAssets(),
      });
      status.textContent = "Editor ready";
      return;
    }
    default: {
      // A new boot outcome must be handled here rather than quietly opening the
      // template — the assignment fails to compile if `BootThemeOutcome` grows
      // a kind, which is how the report stayed dropped last time.
      const unhandled: never = requested;
      throw new Error(`Unhandled boot outcome: ${String(unhandled)}`);
    }
  }
}

/**
 * The starter's own declared bytes, read once.
 *
 * A new theme declares a packaged backdrop, and a declaration without bytes is
 * a broken theme: the media layer would report it unreadable and the artboard
 * would show nothing behind the glass. A package opened from disk brings its
 * own, which is why this is only wired into the two paths that *build* the
 * starter. `docs/decisions/0011`.
 */
let starterBytes: Promise<Readonly<Record<string, Uint8Array>>> | undefined;
function starterAssets(): Promise<Readonly<Record<string, Uint8Array>>> {
  starterBytes ??= loadStarterBackdrop();
  return starterBytes;
}

void start();

function semanticKeys(envelope: FabricThemeEnvelopeInput): readonly string[] {
  return [
    ...new Set(
      Object.values(envelope.bindings ?? {}).flatMap((bindings) =>
        bindings.map((binding) => binding.semanticKey),
      ),
    ),
  ];
}

function envelopeInputFor(
  envelope: FabricThemeEnvelope,
): FabricThemeEnvelopeInput {
  const {
    schemaVersion: _schemaVersion,
    fabricVersion: _fabricVersion,
    scene: _scene,
    ...input
  } = envelope;
  return input;
}
