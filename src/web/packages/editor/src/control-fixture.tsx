import { RadioGroup } from "@base-ui/react/radio-group";
import type * as React from "react";
import { createRoot } from "react-dom/client";
import { ControlChoiceRow } from "./components/ui/control-choice-row.js";
import { ControlIconButton } from "./components/ui/control-icon-button.js";
import { ControlNumber } from "./components/ui/control-number.js";
import { ControlPair } from "./components/ui/control-pair.js";
import { ControlSegmented } from "./components/ui/control-segmented.js";
import { ControlSelect } from "./components/ui/control-select.js";
import { ControlSlider } from "./components/ui/control-slider.js";
import { ControlSwatch } from "./components/ui/control-swatch.js";
import { ControlText } from "./components/ui/control-text.js";
import { ControlToggle } from "./components/ui/control-toggle.js";
import { InspectorSection } from "./components/ui/inspector-section.js";
import "./editor-shell/editor-shell.css";

/**
 * The design-language parity fixture.
 *
 * It mounts every control of DESIGN.md §5's vocabulary — alone and inside the
 * `InspectorSection` a surface composes them into — over the built stylesheet,
 * and renders the states the language is *made of* rather than the happy path
 * alone: a required label, a refusal with its reason, an invalid draft, a
 * checked toggle, a selected segment, a destructive action and a focused
 * target. It is a build entry of its own (`vite.config.fixture.ts`,
 * `npm run build:fixture`), so the preview can load it as a page without the
 * shipped editor emitting it; `react-root-disposal.dom.test.ts` excludes it
 * among the harness pages whose root lives as long as the page.
 *
 * It is wrapped in `.editor-shell` on purpose, and neither the wrapper nor the
 * `bg-panel` columns are decoration: the shell owns the backdrop the chrome is
 * composited over and the reduced-motion policy the controls inherit, so
 * measuring contrast or motion outside it would measure a page nobody ships.
 * The columns are the inspector's own 276px, because §7.8 asks labels, hit
 * areas and contrast be read at the real pane width rather than at a comfortable
 * one.
 *
 * **The columns are the ancestors the product's are, and the product has two.**
 * The inspector column is `.editor-shell-inspector` and the pane column is
 * `.editor-shell-panel` (both are what `editor-shell.css`'s legacy rules keyed
 * on), and a fixture that mounted only the first was *greener* than the product:
 * every control assertion passed on a surface with one fewer stylesheet applied
 * (`vg-299`), and the unlayered `.editor-shell-panel input` box survived one
 * ancestor to the left of the fixed one for a whole round because the fixture
 * could not see it. Two ancestors are the instrument, not decoration. The
 * `editor-glass` both asides also carry is deliberately not mounted — it is a
 * backdrop treatment of the column, and the root already stands in for the
 * surface the chrome is composited over.
 *
 * The pane column also mounts the two row shapes a surface gives a row that the
 * field row does not: the settings modal's `boxed` switch row and the Add pane's
 * `headed` asset picker. Both come from a surface's own drawing rather than from
 * the control set's default, so the fixture is where they are measured.
 *
 * Every class here is a role or a scale step. A literal would be the defect the
 * fixture exists to catch, so the fixture is held to the same ratchet
 * (`design-tokens.gated.json`) as the controls it mounts.
 */

/** A name an author could really type: long, mixed-script, and unbreakable
 *  enough to be the case §7.7's "a long name cannot widen a pane" is about. */
const LONG_NAME =
  "Måneoverflate-temperatur ℃ ẞ 日本語のラベル 🎛 the long authored name";

const SHOWS = [
  { id: "cpu.load", name: "CPU load" },
  { id: "mem.used", name: "Memory used" },
] as const;
const PAINTS = [
  { id: "ink", name: "Ink" },
  { id: "paper", name: "Paper" },
] as const;
const ALIGN = [
  { id: "left", name: "Left" },
  { id: "center", name: "Center" },
] as const;

const noop = (): void => {};

function Fixture(): React.JSX.Element {
  return (
    <div className="editor-shell" data-fixture-root>
      <div className="flex flex-wrap items-start gap-[var(--space-12)] p-[var(--space-12)]">
        <aside className="editor-shell-inspector w-[276px] bg-panel p-[var(--space-12)]">
          <InspectorSection id="content" title="Content">
            <div data-fixture="text">
              <ControlText label="Name" value="CPU gauge" onCommit={noop} />
            </div>
            <div data-fixture="long">
              <ControlText
                label={LONG_NAME}
                value={LONG_NAME}
                onCommit={noop}
              />
            </div>
            <div data-fixture="select">
              <ControlSelect
                label="Shows"
                value="cpu.load"
                options={SHOWS}
                onChange={noop}
              />
            </div>
            <div data-fixture="swatch">
              <ControlSwatch
                label="Fill"
                value="ink"
                options={PAINTS}
                onChange={noop}
                swatch={
                  <span
                    aria-hidden
                    className="size-[11px] rounded-sm bg-accent"
                  />
                }
              />
            </div>
          </InspectorSection>

          <InspectorSection id="position" title="Position">
            <div data-fixture="number">
              <ControlNumber
                label="Width"
                value={299}
                unit="px"
                min={0}
                max={1000}
                onCommit={noop}
              />
            </div>
            <div data-fixture="slider">
              <ControlSlider
                label="Opacity"
                value={50}
                min={0}
                max={100}
                onCommit={noop}
              />
            </div>
          </InspectorSection>

          <InspectorSection id="layer" title="Layer">
            <div data-fixture="toggle">
              <ControlToggle label="Glass" checked={false} onChange={noop} />
            </div>
            <div data-fixture="toggle-on">
              <ControlToggle label="Locked" checked onChange={noop} />
            </div>
            <div data-fixture="segmented">
              <ControlSegmented
                label="Align"
                value="left"
                options={ALIGN}
                onChange={noop}
                data={{ "data-fixture-segmented": "1" }}
              />
            </div>
          </InspectorSection>

          {/* §5's Choice row, mounted so the spacing, role and focus gates all
              see it. Two rows, one checked: the focus is driven onto the
              unchecked one, which is what makes "focus distinct from checked
              state" a rendered state and not a class. The checked row carries
              `--stage` and an accent border; the unchecked one `--panel-2`. */}
          <InspectorSection id="palette" title="Palette">
            <div data-fixture="choice-rows">
              <RadioGroup
                value="editorial"
                onValueChange={noop}
                aria-label="Shell palette"
                className="flex flex-col gap-[var(--space-6)]"
              >
                <ControlChoiceRow
                  label="editorial"
                  value="editorial"
                  swatch={
                    <span
                      aria-hidden
                      className="size-[11px] rounded-sm bg-accent"
                    />
                  }
                />
                <ControlChoiceRow
                  label="graphite"
                  value="graphite"
                  swatch={
                    <span
                      aria-hidden
                      className="size-[11px] rounded-sm bg-muted"
                    />
                  }
                />
              </RadioGroup>
            </div>
          </InspectorSection>
        </aside>

        <aside className="editor-shell-inspector w-[276px] bg-panel p-[var(--space-12)]">
          <InspectorSection id="states" title="Refused and invalid">
            <div data-fixture="refused">
              <ControlToggle
                label="Glass"
                checked={false}
                onChange={noop}
                refused="not offered for a group"
              />
            </div>
            <div data-fixture="refused-number">
              <ControlNumber
                label="Blur"
                value={2}
                min={0}
                max={10}
                onCommit={noop}
                refused="not offered for a group"
              />
            </div>
            <div data-fixture="invalid">
              <ControlNumber
                label="Steps"
                value={3}
                min={0}
                max={10}
                onCommit={noop}
                data={{ "data-fixture-invalid": "1" }}
              />
            </div>
            <div data-fixture="icon">
              <ControlIconButton
                label="Delete layer"
                destructive
                onClick={noop}
              >
                <span aria-hidden>✕</span>
              </ControlIconButton>
            </div>
            <div data-fixture="icon-focus">
              <ControlIconButton
                label="Duplicate layer"
                shortcut={{ printed: "Ctrl+D", spoken: "Control D" }}
                onClick={noop}
              >
                <span aria-hidden>⧉</span>
              </ControlIconButton>
            </div>
          </InspectorSection>
        </aside>

        {/* The pane column, and the product's second ancestor: `.editor-shell-panel`
            is the box `panes/document/metadata-fields.tsx` composes `ControlText`
            inside, so the panes' field rows are the same control set under a
            different surface's stylesheet. It is the same 246px the rail gives a
            pane (§7.8: a label reads at the real pane width, not a comfortable
            one). */}
        <aside className="editor-shell-panel w-[246px] bg-panel p-[var(--space-12)]">
          <InspectorSection id="pane-fields" title="Pane fields">
            <div data-fixture="pane-text">
              <ControlText label="Author" value="Yunari" onCommit={noop} />
            </div>
            {/* The two shapes a row takes when a drawing shapes it differently.
                The boxed switch is the settings modal's and the headed picker is
                the Add pane's; both are here because the fixture is where a
                shape is measured, and neither is a labelled field row. */}
            <div data-fixture="boxed">
              <ControlToggle
                label="Follow the system"
                checked={false}
                onChange={noop}
                shape="boxed"
              />
            </div>
            <div data-fixture="headed">
              <ControlSelect
                label="Asset"
                value="cpu.load"
                options={SHOWS}
                onChange={noop}
                shape="headed"
                data={{ "data-fixture-select": "headed" }}
              />
            </div>
            {/* Two wells of very different magnitudes, because equal halves that
                are equal by accident look the same as equal halves that are
                right: the pair's halves are `flex:1` in the drawing, not sized
                by the number they print (`vg-302`'s neighbour). */}
            <div data-fixture="pair">
              <ControlPair
                label="Size"
                halves={[
                  { label: "W", value: 4, onCommit: noop },
                  { label: "H", value: 4000, onCommit: noop },
                ]}
              />
            </div>
          </InspectorSection>
        </aside>
      </div>
    </div>
  );
}

const host = document.querySelector("#control-fixture");
if (host === null)
  throw new Error("the control fixture has no #control-fixture");
createRoot(host).render(<Fixture />);
