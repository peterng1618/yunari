// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveShortcuts, setActiveShortcuts } from "./bindings.js";
import { PRODUCT_SHORTCUTS, ShortcutManager } from "./index.js";

afterEach(() => {
  // The live table is module state: a case that rebinds puts it back, or the
  // next case in this file inherits a preference it never made.
  setActiveShortcuts(PRODUCT_SHORTCUTS);
});

describe("ShortcutManager", () => {
  it("claims registered Yunari actions and leaves all other canvas keys alone", () => {
    const manager = new ShortcutManager();
    const save = vi.fn();
    manager.register("file.save", save);
    const handled = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      cancelable: true,
    });
    const canvasKey = new KeyboardEvent("keydown", {
      key: "g",
      ctrlKey: true,
      cancelable: true,
    });

    window.dispatchEvent(handled);
    window.dispatchEvent(canvasKey);

    expect(save).toHaveBeenCalledOnce();
    expect(handled.defaultPrevented).toBe(true);
    expect(canvasKey.defaultPrevented).toBe(false);
    manager.destroy();
  });

  it("does not steal New from an editable field", () => {
    const manager = new ShortcutManager();
    const create = vi.fn();
    manager.register("file.new", create);
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", {
      key: "n",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(create).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    input.remove();
    manager.destroy();
  });

  it("keeps Save available while a text field has focus", () => {
    const manager = new ShortcutManager();
    const save = vi.fn();
    manager.register("file.save", save);
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(save).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    input.remove();
    manager.destroy();
  });

  it("dispatches Ctrl+Z/Ctrl+Y to undo/redo", () => {
    const manager = new ShortcutManager();
    const undo = vi.fn();
    const redo = vi.fn();
    manager.register("edit.undo", undo);
    manager.register("edit.redo", redo);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        cancelable: true,
      }),
    );

    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("dispatches Ctrl+Shift+Z to redo and keeps Ctrl+Y", () => {
    // The standard redo in Photoshop, Affinity and Figma. It has to *not* fall
    // through to undo: `edit.undo`'s binding has no `shift` field, so a table
    // without the shift-qualified redo in front of it turns the one chord every
    // arriving author knows into an undo.
    const manager = new ShortcutManager();
    const undo = vi.fn();
    const redo = vi.fn();
    manager.register("edit.undo", undo);
    manager.register("edit.redo", redo);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Z",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );

    expect(redo).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(redo).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  it("routes Meta+Shift+Z to redo, so macOS is not left behind", () => {
    const manager = new ShortcutManager();
    const redo = vi.fn();
    manager.register("edit.redo", redo);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Z",
        metaKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );

    expect(redo).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("leaves redo to a focused text field on the standard chord too", () => {
    // `edit.redo` is in `MODIFIED_KEY_DEFERRED_ACTION_IDS` by action id, so the
    // new binding inherits the deferral. Ctrl+Shift+Z inside a rename field is
    // that field's own redo of its text.
    const manager = new ShortcutManager();
    const redo = vi.fn();
    manager.register("edit.redo", redo);
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", {
      key: "Z",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(redo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    input.remove();
    manager.destroy();
  });

  it("does not steal undo from an editable field", () => {
    const manager = new ShortcutManager();
    const undo = vi.fn();
    manager.register("edit.undo", undo);
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    input.remove();
    manager.destroy();
  });
});

describe("ShortcutManager unmodified keys", () => {
  it("fires edit.delete for Delete and Backspace with no modifier", () => {
    const manager = new ShortcutManager();
    const handler = vi.fn();
    manager.register("edit.delete", handler);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));

    expect(handler).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  it("never fires an unmodified shortcut while a text field has focus", () => {
    const manager = new ShortcutManager();
    const handler = vi.fn();
    manager.register("edit.delete", handler);
    const field = document.createElement("textarea");
    document.body.append(field);

    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();
    field.remove();
    manager.destroy();
  });

  it("separates group and ungroup by the shift modifier", () => {
    const manager = new ShortcutManager();
    const group = vi.fn();
    const ungroup = vi.fn();
    manager.register("edit.group", group);
    manager.register("edit.ungroup", ungroup);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "G", ctrlKey: true, shiftKey: true }),
    );

    expect(group).toHaveBeenCalledOnce();
    expect(ungroup).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("sends the standard chords to front and back, and keeps the bare ones", () => {
    // `event.key` under Shift is the shifted character, not the bracket: a
    // browser reports `{` and `}` for Ctrl+Shift+[ and Ctrl+Shift+]. Binding the
    // shifted characters is what makes the standard chord work at all.
    const manager = new ShortcutManager();
    const front = vi.fn();
    const back = vi.fn();
    manager.register("canvas.front", front);
    manager.register("canvas.back", back);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "}",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "{",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(front).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();

    // The existing pair still works — additive, not a replacement.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "]", ctrlKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "[", ctrlKey: true }),
    );
    expect(front).toHaveBeenCalledTimes(2);
    expect(back).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  it("routes Meta+Shift+] and Meta+] to front, so macOS is not left behind", () => {
    const manager = new ShortcutManager();
    const front = vi.fn();
    manager.register("canvas.front", front);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "}",
        metaKey: true,
        shiftKey: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "]", metaKey: true }),
    );

    expect(front).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  it("leaves an unregistered shortcut's default behaviour alone", () => {
    const manager = new ShortcutManager();
    const event = new KeyboardEvent("keydown", {
      key: "Delete",
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    manager.destroy();
  });

  it("nudges on an arrow key and defers to a text field", () => {
    const manager = new ShortcutManager();
    const nudge = vi.fn();
    manager.register("canvas.nudge-left", nudge);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(nudge).toHaveBeenCalledTimes(1);

    // Dispatched ON the input, not on `window`. `window.dispatchEvent` sets the
    // event's `target` to `window` itself, so `isTextEntryTarget(event.target)`
    // reads the window and the nudge fires a second time — the assertion below
    // could never hold, whatever the binding did. `bubbles: true` is what carries
    // it up to the window listener; this is the idiom every existing deferral
    // test in this file already uses (`:42`, `:61`, `:109`, `:139`).
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(nudge).toHaveBeenCalledTimes(1);
    input.remove();
    manager.destroy();
  });

  it("routes both plain and shift+arrow to the same action", () => {
    const manager = new ShortcutManager();
    const nudge = vi.fn();
    // One id, one handler: the large step is the handler reading event.shiftKey,
    // not a second action id. A bare `vi.fn()` accepts and ignores that argument.
    // The Produces union above is the authority on which ids exist.
    manager.register("canvas.nudge-left", nudge);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true }),
    );
    expect(nudge).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  it("takes a modifier chord back from a focused range, and leaves the range its own keys", () => {
    // A slider is not a text field, so `Ctrl+Z` is not a key it has any use for
    // and the manager must take it — which is what a focused range swallowed
    // (`vg-252`). The arrows are the other half: a range moves on them, so they
    // stay its own, and that is why a range was in the deferral at all.
    const manager = new ShortcutManager();
    const undo = vi.fn();
    const nudge = vi.fn();
    const remove = vi.fn();
    manager.register("edit.undo", undo);
    manager.register("canvas.nudge-left", nudge);
    manager.register("edit.delete", remove);
    const slider = document.createElement("input");
    slider.type = "range";
    document.body.append(slider);
    slider.focus();

    const chord = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    slider.dispatchEvent(chord);
    expect(undo).toHaveBeenCalledOnce();
    expect(chord.defaultPrevented).toBe(true);

    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
    });
    slider.dispatchEvent(arrow);
    expect(nudge).not.toHaveBeenCalled();
    expect(arrow.defaultPrevented).toBe(false);

    // Nothing else the table binds is the slider's either.
    slider.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(remove).toHaveBeenCalledOnce();

    slider.remove();
    manager.destroy();
  });
});

describe("ShortcutManager context bindings", () => {
  it("dispatches Escape to the group-exit action", () => {
    const manager = new ShortcutManager();
    const exit = vi.fn();
    manager.register("view.exit-group", exit);

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(exit).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    manager.destroy();
  });

  it("leaves Escape to a focused text field", () => {
    // Fabric's own editing case is the same contract: its hidden textarea
    // handles Escape itself and stops propagation, so this binding cannot fire.
    const manager = new ShortcutManager();
    const exit = vi.fn();
    manager.register("view.exit-group", exit);
    const field = document.createElement("textarea");
    document.body.append(field);

    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(exit).not.toHaveBeenCalled();
    field.remove();
    manager.destroy();
  });
});

describe("ShortcutManager and the author's own table", () => {
  it("runs the rebind and stops answering the default it replaced", () => {
    // A rebinding has to change what the dispatcher *runs* and not only what the
    // reference prints. Both halves are asserted here because either one alone
    // is the defect: a table nobody dispatches, or a mark that runs nothing.
    const manager = new ShortcutManager();
    const ran = vi.fn();
    manager.register("publish.surface", ran);

    setActiveShortcuts(
      resolveShortcuts({
        "publish.surface": {
          key: "j",
          modifier: true,
          shift: false,
          action: "publish.surface",
        },
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(ran).toHaveBeenCalledOnce();

    // The default chord is no longer this action's: the override *replaced*
    // every alias it had rather than adding one beside them.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "P",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(ran).toHaveBeenCalledOnce();
    manager.destroy();
  });
});

describe("ShortcutManager and a modal", () => {
  it("fires the reference binding on the question mark", () => {
    const manager = new ShortcutManager();
    const open = vi.fn();
    manager.register("help.shortcuts", open);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", cancelable: true }),
    );

    expect(open).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("lets a text field have its own question mark", () => {
    const manager = new ShortcutManager();
    const open = vi.fn();
    manager.register("help.shortcuts", open);
    const input = document.createElement("input");
    document.body.append(input);

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", bubbles: true }),
    );

    expect(open).not.toHaveBeenCalled();
    input.remove();
    manager.destroy();
  });

  it("refuses every binding while a dialog is open, and answers again once it closes", () => {
    // Both shapes, because the editor has both: the three native modals and the
    // library one on Base UI. A predicate that knew
    // only one of them would let an author edit the document they are reading
    // about.
    const manager = new ShortcutManager();
    const remove = vi.fn();
    manager.register("edit.delete", remove);

    const native = document.createElement("dialog");
    document.body.append(native);
    native.setAttribute("open", "");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    native.remove();

    // The library's real output: `role="dialog"` and **no `aria-modal`** — it
    // hides the content's siblings with `aria-hidden` instead. Measured on
    // `@base-ui/react` 1.8.0, which sets `role: 'dialog'` on its popup and
    // carries no `aria-modal` anywhere in the package. Built to match that, not
    // to match an assumption, because a predicate keyed on `aria-modal` passes
    // this test against a shape the library does not render and then defers
    // nothing in the product.
    const library = document.createElement("div");
    library.setAttribute("role", "dialog");
    document.body.append(library);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    library.remove();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    expect(remove).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("leaves Escape to the group-exit action when no dialog is open", () => {
    // Escape is the one binding a dialog also answers to, so a guard that
    // swallowed it unconditionally would take the author out of their group
    // *and* close the sheet on one press.
    const manager = new ShortcutManager();
    const exit = vi.fn();
    manager.register("view.exit-group", exit);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );

    expect(exit).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("asks about the dialog before the same dispatch that tears it down", () => {
    // The worst-case ordering, reproduced because jsdom does not produce it on
    // its own. Both libraries bind `keydown` on `document` with
    // `{ capture: true }`, which runs before this manager's `window` bubble
    // listener. Radix then unmounted its dialog synchronously — its
    // `Presence` read `getComputedStyle(node).animationName`, found `"none"` and
    // tore down from a layout effect inside the same dispatch, which is
    // `vg-187`: the sheet closed *and* `view.exit-group` ran on one press. Base
    // UI keeps the popup mounted behind `hidden` until the close settles, so it
    // may not be reachable now. **This case is kept either way**: it pins the
    // guard's contract, which is to answer as of the start of the dispatch and
    // not when it happens to run, independently of which library is underneath.
    const manager = new ShortcutManager();
    const exit = vi.fn();
    manager.register("view.exit-group", exit);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);

    // That ordering, reproduced: a document-capture listener removes the dialog
    // synchronously, inside the one dispatch, before the window bubble listener
    // runs. Mounted and unmounted inside the test.
    const teardown = (): void => dialog.remove();
    document.addEventListener("keydown", teardown, { capture: true });

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(exit).not.toHaveBeenCalled();
    document.removeEventListener("keydown", teardown, { capture: true });
    dialog.remove();
    manager.destroy();
  });
});
