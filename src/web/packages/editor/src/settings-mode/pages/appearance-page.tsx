import { RadioGroup } from "@base-ui/react/radio-group";
import { ControlChoiceRow } from "../../components/ui/control-choice-row.js";
import { ControlToggle } from "../../components/ui/control-toggle.js";
import {
  applyShellPalette,
  clearShellChoice,
  prefersDarkAppearance,
  type ShellPalette,
  shellPalettes,
  systemShellPalette,
  writeShellChoice,
} from "../../editor-shell/palette.js";
import { uiCopy } from "../../ui-copy.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/** The id the palette group is named by, kept out of the shell's other ids. */
const PALETTE_GROUP_ID = "yunari-settings-palette";

/**
 * The Appearance page: the shell palette. It is an editor preference rather
 * than document state, so it reads no open theme and applies to every shell
 * surface at once. The preview ratios and custom shapes that used to share
 * this page are destinations of their own.
 */
export function AppearancePage(props: {
  /** `undefined` where the browser refuses local storage; a choice then holds
   *  for the session rather than refusing to be made. */
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <Page page="appearance">
      <PaletteSection
        storage={props.storage}
        palette={props.palette}
        following={props.following}
        onPalette={props.onPalette}
        onFollowing={props.onFollowing}
      />
    </Page>
  );
}

/** The six shell palettes and follow-the-system.
 *
 *  The six are **cards in one radio group** rather than a `Segmented`, which
 *  the design sizes at 2–4 labels: six lifted segments is a control the design
 *  does not draw. The group takes the grid (`repeat(3,1fr)` of `--radius-lg`
 *  cards), so the columns follow it; the group's own keyboard model still walks
 *  the six in reading order, and a narrower page changing the columns would not
 *  change the arrow keys. */
function PaletteSection(props: {
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
}): React.JSX.Element {
  const { storage, palette, following, onPalette, onFollowing } = props;

  /** The three steps the choice has always taken, in a fixed order: storage
   *  first (it is what stops the OS having a vote), then the attribute every
   *  palette block and every portalled surface reads, then the shell's live
   *  state. */
  const choose = (next: ShellPalette): void => {
    if (storage !== undefined) writeShellChoice(storage, next);
    applyShellPalette(next);
    onPalette(next);
    onFollowing(false);
  };

  /** Turning following on deletes the stored choice — that key's absence is
   *  what "no choice" means to `readShellChoice` — and resolves the OS at once.
   *  Turning it off pins what is already resolved. */
  const follow = (next: boolean): void => {
    onFollowing(next);
    if (next) {
      if (storage !== undefined) clearShellChoice(storage);
      const resolved = systemShellPalette(prefersDarkAppearance());
      applyShellPalette(resolved);
      onPalette(resolved);
      return;
    }
    if (storage !== undefined) writeShellChoice(storage, palette);
  };

  return (
    <Group
      testId="palette"
      headingId={PALETTE_GROUP_ID}
      name={uiCopy.settings.palette}
    >
      <RadioGroup
        value={palette}
        onValueChange={choose}
        aria-labelledby={PALETTE_GROUP_ID}
        className="grid grid-cols-3 gap-[var(--space-8)]"
      >
        {shellPalettes.map((entry) => (
          <ControlChoiceRow
            key={entry}
            shape="card"
            label={entry}
            value={entry}
            data={{ "data-yunari-palette-choice": entry }}
            swatch={
              <span className="flex gap-[var(--space-4)]" aria-hidden>
                <span
                  className="editor-shell-palette-swatch"
                  data-shell-palette={entry}
                />
                <span
                  className="editor-shell-palette-swatch-accent"
                  data-shell-palette={entry}
                />
              </span>
            }
          />
        ))}
      </RadioGroup>
      <div className="mt-[var(--space-14)]">
        <ControlToggle
          shape="boxed"
          label={uiCopy.settings.followSystem}
          checked={following}
          hint={
            storage === undefined
              ? uiCopy.settings.followSystemSessionOnly
              : uiCopy.settings.followSystemHint
          }
          data={{ "data-yunari-follow-system": "" }}
          onChange={follow}
        />
      </div>
    </Group>
  );
}
