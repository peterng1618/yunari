import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeShortcuts,
  resolveShortcuts,
  setActiveShortcuts,
} from "./bindings.js";
import {
  bindingLabel,
  printableChord,
  shortcutLabel,
  shortcutSpokenLabel,
  usesCommandKey,
} from "./display.js";
import { PRODUCT_SHORTCUTS, type ShortcutBinding } from "./index.js";

/** `navigator.userAgent` is the only platform signal every browser here has. */
function onPlatform(userAgent: string): void {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const MACINTOSH = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

afterEach(() => {
  vi.restoreAllMocks();
  // The live table is module state, so a case that rebinds must put it back or
  // the next file inherits its preference.
  setActiveShortcuts(PRODUCT_SHORTCUTS);
});

describe("shortcutLabel", () => {
  it("spells the modifiers on a platform whose keyboard spells them", () => {
    onPlatform(WINDOWS);
    expect(usesCommandKey()).toBe(false);
    expect(shortcutLabel("edit.undo")).toBe("Ctrl+Z");
    expect(shortcutLabel("canvas.select-all")).toBe("Ctrl+A");
    expect(shortcutLabel("edit.delete")).toBe("Delete · Backspace");
  });

  it("prints the glyphs on a platform whose keyboard has them", () => {
    // `shortcut-manager/index.ts:76` accepts `ctrlKey` OR `metaKey` everywhere,
    // so the binding is never wrong. What is wrong is *showing* Ctrl to an
    // author whose keyboard has no Ctrl for this — and nothing on this machine
    // would notice, which is why the platform is stubbed rather than read.
    onPlatform(MACINTOSH);
    expect(usesCommandKey()).toBe(true);
    expect(shortcutLabel("edit.undo")).toBe("⌘Z");
    expect(shortcutLabel("edit.redo")).toBe("⌘⇧Z · ⌘Y");
  });

  it("joins every chord an action answers to, in the table's order", () => {
    onPlatform(WINDOWS);
    // Both are deliberate: `index.ts:39-42` keeps Ctrl+Y alongside the standard
    // chord because Figma has it and someone learned it here.
    expect(shortcutLabel("edit.redo")).toBe("Ctrl+Shift+Z · Ctrl+Y");
  });

  it("renders a shifted character as the browser reports it, without a Shift cap", () => {
    onPlatform(WINDOWS);
    // `index.ts:49-54` binds `}` and `{` because Shift makes the browser report
    // the shifted character. "Ctrl+Shift+}" names a key nobody has and matches
    // nothing; "Ctrl+}" is the character the event carries.
    expect(shortcutLabel("canvas.front")).toBe("Ctrl+} · Ctrl+]");
    expect(shortcutLabel("canvas.back")).toBe("Ctrl+{ · Ctrl+[");
  });

  it("leaves a bound action's chord empty rather than inventing one", () => {
    onPlatform(WINDOWS);
    // `view.exit-group` is in the manager and deliberately not in the table
    // (`index.ts:67-71`). A caller that asks for it gets nothing back — the
    // renderer never guesses a default, which is the same rule the repo applies
    // to a refused numeric field.
    expect(shortcutLabel("view.exit-group")).toBe("");
  });
});

describe("the display vocabulary", () => {
  it("names no key that only a context-only binding can carry", () => {
    // `escape` is named in one table only: its one binding lives in
    // `CONTEXT_SHORTCUTS`, whose own
    // comment says those bindings are never displayed. Naming it here — `Esc`
    // printed, `Escape` spoken — would make two modules disagree
    // about whether Escape is displayable; the vocabulary takes the side
    // the binding's owner takes, so a cap the product cannot print is not in the
    // table to be printed.
    const onEscape: ShortcutBinding = {
      key: "escape",
      modifier: false,
      action: "view.exit-group",
    };
    // The printed half, which is `keyCap(key, false)` — it reads `NAMED_KEYS`
    // and only `NAMED_KEYS`: restoring `NAMED_KEYS.escape` alone reddens these
    // two.
    expect(printableChord(onEscape)).toBe(false);
    expect(bindingLabel(onEscape)).toBe("");

    // The spoken half reads whichever entry survived, because `keyCap` falls
    // back to `NAMED_KEYS` — so this catches a restored `SPOKEN_NAMED_KEYS
    // .escape` as well, which the two above cannot. It speaks through the live
    // table, which is the only way in: the table is set by hand because a
    // binding on Escape is the one arrangement that reaches the spoken lookup
    // for this key at all, and an arrangement the vocabulary must not be able
    // to name. `afterEach` puts the product's own table back.
    setActiveShortcuts([onEscape]);
    expect(shortcutSpokenLabel("view.exit-group")).toBe("");

    // And the same rule read from the other side: a key the product *does*
    // display keeps its name, so this cannot pass by emptying the table.
    expect(
      printableChord({ key: "delete", modifier: false, action: "edit.delete" }),
    ).toBe(true);
  });
});

describe("the effective table", () => {
  it("prints the author's chord for the action they rebound, and the defaults for the rest", () => {
    // Review Focus 3's unit half: this is what every surface prints a chord
    // through, so a rebind that reached the dispatcher and not this function is
    // a mark that runs something else. The break the brief names — pointing
    // these two at `PRODUCT_SHORTCUTS` instead — reddens exactly this case.
    onPlatform(WINDOWS);
    const moved: ShortcutBinding = {
      key: "j",
      modifier: true,
      shift: false,
      action: "publish.surface",
    };
    setActiveShortcuts(resolveShortcuts({ "publish.surface": moved }));

    expect(shortcutLabel("publish.surface")).toBe("Ctrl+J");
    expect(shortcutSpokenLabel("publish.surface")).toBe("Control J");
    // Untouched actions keep the table's own chord, so a rebind is one row's.
    expect(shortcutLabel("edit.undo")).toBe("Ctrl+Z");
    expect(activeShortcuts()).not.toEqual(PRODUCT_SHORTCUTS);
  });
});

describe("shortcutSpokenLabel", () => {
  it("calls the marks by name, on the platform whose keyboard carries them", () => {
    // The whole reason this exists: `⌘` is announced by a screen reader as
    // "place of interest sign" and `⇧` as "upwards white arrow", so a `<kbd>`
    // labelled with the printed chord reads as the name of a picture.
    onPlatform(MACINTOSH);
    expect(shortcutSpokenLabel("edit.undo")).toBe("Command Z");
    expect(shortcutSpokenLabel("edit.redo")).toBe(
      "Command Shift Z or Command Y",
    );
  });

  it("speaks the same modifier the printed chord prints", () => {
    onPlatform(WINDOWS);
    expect(shortcutSpokenLabel("edit.undo")).toBe("Control Z");
    expect(shortcutLabel("edit.undo")).toBe("Ctrl+Z");
  });

  it("names the arrows, which print as marks", () => {
    onPlatform(WINDOWS);
    expect(shortcutLabel("canvas.nudge-left")).toBe("←");
    expect(shortcutSpokenLabel("canvas.nudge-left")).toBe("Left arrow");
    // The context-only action is the one a caller can still ask for, and it
    // answers with nothing rather than with a chord.
    expect(shortcutLabel("view.exit-group")).toBe("");
  });

  it("joins two chords with a word, because the printed separator is punctuation", () => {
    onPlatform(WINDOWS);
    // ` · ` is read as a pause or not at all; "or" says what the two chords are.
    expect(shortcutLabel("edit.delete")).toBe("Delete · Backspace");
    expect(shortcutSpokenLabel("edit.delete")).toBe("Delete or Backspace");
  });
});
