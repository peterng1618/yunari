import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeShortcuts,
  bindingRefusal,
  clearShortcutOverride,
  clearShortcutOverrides,
  readShortcutOverrides,
  resolveShortcuts,
  type ShortcutOverrides,
  setActiveShortcuts,
  subscribeShortcuts,
  withoutShortcutOverride,
  writeShortcutOverride,
} from "./bindings.js";
import {
  PRODUCT_SHORTCUTS,
  productShortcutIds,
  type ShortcutBinding,
} from "./index.js";

/** An in-memory `Storage`. The module takes an injected store rather than
 *  reaching for `localStorage` — the same shape `palette.ts` has — so the
 *  runtime tests can drive it in a node environment with no DOM at all. */
function store(initial: Readonly<Record<string, string>> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

const KEY = "yunari.editor.shortcut-overrides";

/** Ctrl+Shift+P, the chord the header prints. */
const PUBLISH_CHORD: ShortcutBinding = {
  key: "p",
  modifier: true,
  shift: true,
  action: "publish.surface",
};

/** Ctrl+S — bound to `file.save` by the defaults, so it is the chord that must
 *  be refused for anybody else. */
const CONFLICTING_CHORD: ShortcutBinding = {
  key: "s",
  modifier: true,
  shift: false,
  action: "publish.surface",
};

function bindingOf(
  bindings: readonly ShortcutBinding[],
  action: ShortcutBinding["action"],
): ShortcutBinding | undefined {
  return bindings.find((binding) => binding.action === action);
}

function overriding(
  action: ShortcutBinding["action"],
  binding: ShortcutBinding,
): ShortcutOverrides {
  return { [action]: binding };
}

afterEach(() => {
  setActiveShortcuts(PRODUCT_SHORTCUTS);
});

describe("resolveShortcuts", () => {
  it("resolves the defaults when nothing is stored, and the override when one is", () => {
    // The array is the table's shape — `PRODUCT_SHORTCUTS` is one, and
    // `productShortcutIds()` projects it — so a binding is *found* by its
    // action and never indexed by it. The brief's own test indexed this by id,
    // which is a type error under `noUncheckedIndexedAccess` and was the stale
    // line; the lookup below is the landed form.
    expect(resolveShortcuts({})).toEqual(PRODUCT_SHORTCUTS);
    expect(
      bindingOf(
        resolveShortcuts(overriding("publish.surface", PUBLISH_CHORD)),
        "publish.surface",
      ),
    ).toEqual(PUBLISH_CHORD);
  });

  it("stores one action's chord without disturbing any other action's", () => {
    const next = resolveShortcuts(overriding("publish.surface", PUBLISH_CHORD));
    for (const id of productShortcutIds()) {
      if (id === "publish.surface") continue;
      expect(bindingOf(next, id), id).toEqual(bindingOf(PRODUCT_SHORTCUTS, id));
    }
    // And the order is the table's own, so the sheet cannot be reordered by a
    // preference: the projection reads the table in order and not a map.
    expect(next.map((binding) => binding.action)).toEqual(
      PRODUCT_SHORTCUTS.map((binding) => binding.action),
    );
  });

  it("replaces every default alias of an overridden action with the one chosen chord", () => {
    // `edit.delete` answers to Delete and Backspace. An author who presses a
    // chord means that chord, not that chord beside the two they did not press.
    const chosen: ShortcutBinding = {
      key: "d",
      modifier: true,
      shift: true,
      action: "edit.delete",
    };
    const next = resolveShortcuts(overriding("edit.delete", chosen));
    expect(next.filter((binding) => binding.action === "edit.delete")).toEqual([
      chosen,
    ]);
    // The untouched neighbour keeps both of its own, so the alias rule is the
    // overridden action's and nothing else's.
    expect(
      next.filter((binding) => binding.action === "edit.redo"),
    ).toHaveLength(2);
  });
});

describe("the live table", () => {
  it("answers with the defaults until the shell writes one", () => {
    expect(activeShortcuts()).toEqual(PRODUCT_SHORTCUTS);
  });

  it("notifies its subscribers when it is written, and stops when they leave", () => {
    const listener = vi.fn();
    const off = subscribeShortcuts(listener);
    // A chord other than the default's, or the resolved table would be deep-equal
    // to the defaults and the assertion below could not fail.
    const moved: ShortcutBinding = {
      key: "j",
      modifier: true,
      shift: false,
      action: "publish.surface",
    };
    setActiveShortcuts(resolveShortcuts(overriding("publish.surface", moved)));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(activeShortcuts()).not.toEqual(PRODUCT_SHORTCUTS);
    expect(bindingOf(activeShortcuts(), "publish.surface")).toEqual(moved);

    off();
    setActiveShortcuts(PRODUCT_SHORTCUTS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hands back one array reference between writes, which is what a snapshot needs", () => {
    // `useSyncExternalStore` compares the snapshot by identity: a fresh array on
    // every read is an infinite re-render, not a slower one.
    expect(activeShortcuts()).toBe(activeShortcuts());
  });
});

describe("stored overrides", () => {
  it("writes one action's chord without disturbing any other action's", () => {
    const storage = store();
    writeShortcutOverride(storage, "publish.surface", PUBLISH_CHORD);

    expect(readShortcutOverrides(storage)).toEqual({
      "publish.surface": PUBLISH_CHORD,
    });
    // One namespaced key, exactly as the palette's choice is one.
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe(KEY);
  });

  it("keeps a second action's override when a third is written", () => {
    const storage = store();
    writeShortcutOverride(storage, "publish.surface", PUBLISH_CHORD);
    writeShortcutOverride(storage, "help.shortcuts", {
      key: "h",
      modifier: true,
      shift: false,
      action: "help.shortcuts",
    });

    expect(Object.keys(readShortcutOverrides(storage)).sort()).toEqual([
      "help.shortcuts",
      "publish.surface",
    ]);
  });

  it("returning an action to its default leaves no entry behind", () => {
    const storage = store();
    writeShortcutOverride(storage, "publish.surface", PUBLISH_CHORD);

    clearShortcutOverride(storage, "publish.surface");

    expect(readShortcutOverrides(storage)).not.toHaveProperty(
      "publish.surface",
    );
    expect(
      bindingOf(
        resolveShortcuts(readShortcutOverrides(storage)),
        "publish.surface",
      ),
    ).toEqual(bindingOf(PRODUCT_SHORTCUTS, "publish.surface"));
    // The key goes with the last entry: its absence is what "no overrides"
    // means, and a stored `{}` would be a second spelling of the same state.
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("clears every entry for Reset all", () => {
    const storage = store();
    writeShortcutOverride(storage, "publish.surface", PUBLISH_CHORD);

    clearShortcutOverrides(storage);

    expect(storage.getItem(KEY)).toBeNull();
    expect(readShortcutOverrides(storage)).toEqual({});
  });

  it("refuses damaged JSON rather than letting it disable the defaults", () => {
    // Every one of these is a preference a previous version, a hand-edit or
    // another page could have written. A damaged entry is dropped and the
    // default stands; half a table would be worse than none.
    for (const raw of [
      "not json",
      "[]",
      "null",
      '"a string"',
      JSON.stringify({ "publish.surface": { key: "p", modifier: "yes" } }),
      // A key the dispatcher would never match: `bindingFor` lowercases
      // `event.key`, so a stored `P` is a binding that never fires.
      JSON.stringify({
        "publish.surface": {
          key: "P",
          modifier: true,
          action: "publish.surface",
        },
      }),
      // An action the product does not have, and an action bound on `Escape`
      // in `CONTEXT_SHORTCUTS` — neither has a default row to replace.
      JSON.stringify({
        "publish.open": { key: "p", modifier: true, action: "publish.open" },
      }),
      JSON.stringify({
        "view.exit-group": {
          key: "x",
          modifier: true,
          action: "view.exit-group",
        },
      }),
      // An entry whose own id disagrees with the key it is stored under.
      JSON.stringify({
        "publish.surface": { key: "p", modifier: true, action: "file.save" },
      }),
    ]) {
      const storage = store({ [KEY]: raw });
      expect(readShortcutOverrides(storage), raw).toEqual({});
      expect(
        bindingOf(
          resolveShortcuts(readShortcutOverrides(storage)),
          "publish.surface",
        ),
        raw,
      ).toEqual(bindingOf(PRODUCT_SHORTCUTS, "publish.surface"));
    }
  });

  it("drops a stored chord another action already answers to", () => {
    // A collision is the one damaged preference that would make the keyboard
    // ambiguous rather than merely wrong, so the later entry loses.
    const storage = store({
      [KEY]: JSON.stringify({
        "publish.surface": {
          key: "s",
          modifier: true,
          shift: false,
          action: "publish.surface",
        },
      }),
    });

    expect(readShortcutOverrides(storage)).toEqual({});
  });

  it("refuses a chord whose Shift-qualified form another action answers to, and its plain form too", () => {
    // `edit.undo` is `Ctrl+Z` with no `shift` field, so it *also* matches
    // `Ctrl+Shift+Z` — which `edit.redo` holds first. That precedence is the
    // table's own and is right for the table; it is not a licence for a new
    // chord, whose order is not yet decided, so both presses are refused. This
    // case fails if the check narrows to "each matches the other's own chord".
    for (const shift of [true, false]) {
      const storage = store({
        [KEY]: JSON.stringify({
          "publish.surface": {
            key: "z",
            modifier: true,
            shift,
            action: "publish.surface",
          },
        }),
      });
      expect(readShortcutOverrides(storage), `shift=${shift}`).toEqual({});
    }
  });

  it("keeps a later override the reader would have dropped against the defaults", () => {
    // The reader and the refusal check have to agree about what a stored
    // binding is. `edit.undo` moving to `Ctrl+U` *frees* `Ctrl+Z`, so a second
    // capture onto the freed chord is accepted — and a reader that checked
    // against `PRODUCT_SHORTCUTS` instead of the effective table would take the
    // write, then drop it on the next reload, reverting `file.save` to `Ctrl+S`
    // with nothing said. This case fails on that reader.
    const storage = store();
    const movedUndo: ShortcutBinding = {
      key: "u",
      modifier: true,
      shift: false,
      action: "edit.undo",
    };
    writeShortcutOverride(storage, "edit.undo", movedUndo);
    const ontoFreed: ShortcutBinding = {
      key: "z",
      modifier: true,
      shift: false,
      action: "file.save",
    };
    expect(
      bindingRefusal("file.save", ontoFreed, readShortcutOverrides(storage)),
      "the capture accepts the chord the moved default freed",
    ).toBeUndefined();

    writeShortcutOverride(storage, "file.save", ontoFreed);

    expect(readShortcutOverrides(storage)).toEqual({
      "edit.undo": movedUndo,
      "file.save": ontoFreed,
    });
  });

  it("keeps a later override onto a default alias another action's rebind left free", () => {
    // The mirror case, and the one the *alias* rule decides: `edit.delete`
    // answers to Delete and Backspace, and moving it to `Ctrl+K` takes Backspace
    // out of the effective table entirely. A bare Backspace is then a chord the
    // capture accepts for `help.shortcuts`, and the reader has to accept it too.
    const storage = store();
    writeShortcutOverride(storage, "edit.delete", {
      key: "k",
      modifier: true,
      shift: false,
      action: "edit.delete",
    });
    const backspace: ShortcutBinding = {
      key: "backspace",
      modifier: false,
      shift: false,
      action: "help.shortcuts",
    };
    expect(
      bindingRefusal(
        "help.shortcuts",
        backspace,
        readShortcutOverrides(storage),
      ),
      "no default alias answers to Backspace once edit.delete has moved",
    ).toBeUndefined();

    writeShortcutOverride(storage, "help.shortcuts", backspace);

    expect(readShortcutOverrides(storage)["help.shortcuts"]).toEqual(backspace);
  });
});

describe("withoutShortcutOverride", () => {
  it("takes one action out and leaves the rest", () => {
    const next = withoutShortcutOverride(
      {
        ...overriding("publish.surface", PUBLISH_CHORD),
        "help.shortcuts": PUBLISH_CHORD,
      },
      "publish.surface",
    );
    expect(next).not.toHaveProperty("publish.surface");
    expect(next).toHaveProperty("help.shortcuts");
  });
});

describe("bindingRefusal", () => {
  it("accepts a free chord", () => {
    expect(
      bindingRefusal("publish.surface", PUBLISH_CHORD, {}),
    ).toBeUndefined();
  });

  it("names the action a taken chord belongs to", () => {
    expect(bindingRefusal("publish.surface", CONFLICTING_CHORD, {})).toEqual({
      kind: "taken",
      action: "file.save",
    });
  });

  it("refuses a modifier on its own, and a key the product cannot print", () => {
    expect(
      bindingRefusal(
        "publish.surface",
        {
          key: "shift",
          modifier: true,
          shift: true,
          action: "publish.surface",
        },
        {},
      ),
    ).toEqual({ kind: "modifier-only" });
    // `Home` has no cap in `display.ts` and no entry in its name table, so a
    // binding on it could never be printed — which is a chord the reference
    // cannot show, not a chord.
    expect(
      bindingRefusal(
        "publish.surface",
        {
          key: "home",
          modifier: true,
          shift: false,
          action: "publish.surface",
        },
        {},
      ),
    ).toEqual({ kind: "unprintable" });
  });

  it("refuses a chord the browser keeps for itself, naming the whole chord", () => {
    // The chord, not the bare key: `Ctrl+R` is what the browser keeps, and a
    // refusal reading `R` would name a letter that types into every field.
    expect(
      bindingRefusal(
        "publish.surface",
        { key: "r", modifier: true, shift: false, action: "publish.surface" },
        {},
      ),
    ).toEqual({ kind: "reserved", chord: "Ctrl+R" });
  });

  it("refuses a letter whose Shift variant the browser keeps too", () => {
    // The blanket Shift exclusion these replace was never a measurement: it
    // assumed Shift made a chord safe, and `Ctrl+Shift+T` — reopen the closed
    // tab — is one of the chords most likely to be tried (`vg-290`). `a` is
    // Chromium's tab search, so the finder's old Ctrl+Shift+A was a chord the
    // page never saw.
    for (const key of ["a", "n", "r", "t", "w"]) {
      expect(
        bindingRefusal(
          "publish.surface",
          { key, modifier: true, shift: true, action: "publish.surface" },
          {},
        ),
        key,
      ).toEqual({
        kind: "reserved",
        chord: `Ctrl+Shift+${key.toUpperCase()}`,
      });
    }
  });

  it("leaves a Shift variant the browser does not keep bindable", () => {
    // Over-refusing is its own defect: `Ctrl+Shift+P` is Firefox's private
    // window and Chromium leaves it free, so it stays the author's to take.
    expect(
      bindingRefusal(
        "publish.surface",
        { key: "p", modifier: true, shift: true, action: "publish.surface" },
        {},
      ),
    ).toBeUndefined();
  });

  it("refuses a function key the browser keeps, naming the key it keeps", () => {
    // `keyCap` names `f5`, so this refusal is reachable and says what it means:
    // the browser keeps F5. Without the name the key reads unprintable, which is
    // a reason about a mark that plainly exists.
    expect(
      bindingRefusal(
        "publish.surface",
        { key: "f5", modifier: false, shift: false, action: "publish.surface" },
        {},
      ),
    ).toEqual({ kind: "reserved", chord: "F5" });
  });

  it("refuses a printable punctuation key the store cannot carry, so capture cannot outrun the reader", () => {
    // `.` prints as `Ctrl+.` and is free, so nothing but the store's own shape
    // rule stops it — and the reader (`storedBinding`/`KEY_SHAPE`) rejects it,
    // which is the silent revert on reload this refusal exists to prevent. The
    // two rules are the same predicate now, so this list is the reader's.
    for (const key of [".", "/", ",", "=", " "]) {
      expect(
        bindingRefusal(
          "publish.surface",
          { key, modifier: true, shift: false, action: "publish.surface" },
          {},
        ),
        key,
      ).toEqual({ kind: "unbindable" });
    }
  });

  it("refuses a modifier-less letter for an action that does not defer to a text field", () => {
    // `file.save` deliberately fires while a text field has focus; binding it to
    // a bare letter would make it stop, which is the behaviour change the missing-reading rule forbids: a
    // preference may not dress up as one.
    expect(
      bindingRefusal(
        "file.save",
        { key: "s", modifier: false, shift: false, action: "file.save" },
        {},
      ),
    ).toEqual({ kind: "cannot-defer" });
  });

  it("accepts a modifier-less letter for an action that already defers", () => {
    // `edit.delete` is bound unmodified in the defaults, so it already defers
    // unconditionally — a bare letter is the same promise it makes today.
    expect(
      bindingRefusal(
        "edit.delete",
        { key: "k", modifier: false, shift: false, action: "edit.delete" },
        {},
      ),
    ).toBeUndefined();
  });

  it("refuses a chord against the author's own table, not only the defaults", () => {
    const overrides = overriding("help.shortcuts", {
      key: "j",
      modifier: true,
      shift: false,
      action: "help.shortcuts",
    });
    expect(
      bindingRefusal(
        "publish.surface",
        { key: "j", modifier: true, shift: false, action: "publish.surface" },
        overrides,
      ),
    ).toEqual({ kind: "taken", action: "help.shortcuts" });
  });

  it("lets an action take a chord its own other alias held", () => {
    // Only *another* action's mark is a conflict: `edit.delete` may move onto
    // Backspace, because rebinding replaces all of its own aliases.
    expect(
      bindingRefusal(
        "edit.delete",
        {
          key: "backspace",
          modifier: false,
          shift: false,
          action: "edit.delete",
        },
        {},
      ),
    ).toBeUndefined();
  });
});
