import {
  formatInstant,
  instantIn,
  MAX_METADATA_NAME_BYTES,
  normalizeThemeMetadata,
  type ThemeMetadata,
} from "@yunari/renderer-core";
import { ControlSelect } from "../../components/ui/control-select.js";
import { ControlText } from "../../components/ui/control-text.js";
import { ControlRow, useControlIds } from "../../components/ui/control-well.js";
import { languageLabel, THEME_LANGUAGES } from "../../theme-languages.js";
import { THEME_TAG_SEED } from "../../theme-tag-seed.js";
import { uiCopy } from "../../ui-copy.js";
import { TagsField } from "./tags-field.js";

/**
 * The theme's own description: who it is by, what it is for, and the language
 * its words are written in.
 *
 * **Every field commits on its own and the record is rebuilt whole**, because
 * the metadata is one object with one optional key per field: a commit that sent
 * only the typed value would drop the other four on the floor. `normalizeThemeMetadata`
 * is that rule and it lives in renderer-core, so the MCP tools write the same shape
 * — an emptied field loses its key rather than being written as `""`, which the
 * envelope's own validator reads as a present name, and an emptied tag list loses
 * it rather than being written as `[]` — and `themeLanguage` always leaves with a
 * value, because a v2 envelope requires one and the control's blank reading is not
 * a language.
 */
interface MetadataFieldsProps {
  readonly metadata: ThemeMetadata | undefined;
  readonly onCommit: (next: ThemeMetadata) => void;
}

export function MetadataFields(props: MetadataFieldsProps): React.JSX.Element {
  const { metadata, onCommit } = props;
  const versionIds = useControlIds(undefined);
  const sampleIds = useControlIds(undefined);
  const language = metadata?.themeLanguage ?? "en";

  const put = (patch: Partial<ThemeMetadata>): void => {
    onCommit(
      normalizeThemeMetadata({
        themeLanguage: language,
        ...metadata,
        ...patch,
      }),
    );
  };

  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      <ControlText
        label={uiCopy.panels.name}
        data={{ "data-yunari-theme-name": "" }}
        value={metadata?.name ?? ""}
        // The same bound publishing enforces, in the same unit: the store's
        // item name is measured in UTF-8 bytes.
        hint={`At most ${MAX_METADATA_NAME_BYTES} bytes.`}
        onCommit={(value) => put({ name: value })}
      />
      <ControlText
        label={uiCopy.panels.author}
        data={{ "data-yunari-theme-author": "" }}
        value={metadata?.author ?? ""}
        onCommit={(value) => put({ author: value })}
      />
      <ControlText
        label={uiCopy.panels.description}
        data={{ "data-yunari-theme-description": "" }}
        multiline
        rows={4}
        value={metadata?.description ?? ""}
        onCommit={(value) => put({ description: value })}
      />
      <TagsField
        value={metadata?.tags ?? []}
        // The shipped seed, because this pane has no catalogue to ask. The
        // field takes the vocabulary as a value, so the online half is a caller
        // that hands over the catalogue's own tags rather than a second field.
        vocabulary={THEME_TAG_SEED}
        onCommit={(tags) => put({ tags })}
      />
      <ControlSelect
        label={uiCopy.panels.language}
        data={{ "data-yunari-theme-language": "" }}
        value={language}
        options={languageOptions(metadata?.themeLanguage).map((tag) => ({
          id: tag,
          name: languageLabel(tag),
        }))}
        onChange={(tag) => put({ themeLanguage: tag })}
      />
      {/* The sample is a reading of the control above it, not a setting of its
          own: the author changes it by changing the language. Its visible name
          is one word to fit the label column; the status region keeps the longer
          `aria-label` a screen reader announces, which says what it samples. */}
      <ControlRow
        ids={sampleIds}
        label={uiCopy.panels.sampleLabel}
        labelFor={sampleIds.control}
      >
        <output
          id={sampleIds.control}
          data-yunari-theme-language-sample=""
          aria-label={uiCopy.panels.languageSample}
          className="text-sm text-text"
        >
          {sample(language)}
        </output>
      </ControlRow>
      {/* `output` is labelable, so the same pairing every editable field uses
          names a value the author reads but never types. */}
      <ControlRow
        ids={versionIds}
        label={uiCopy.panels.releaseVersion}
        labelFor={versionIds.control}
      >
        <output
          id={versionIds.control}
          data-yunari-theme-version=""
          className="font-mono text-sm text-text"
        >
          {metadata?.version ?? ""}
        </output>
      </ControlRow>
    </div>
  );
}

/**
 * The curated languages, plus the document's own when it declares one outside
 * them: a hand-edited or store-downloaded theme must not be silently rewritten
 * to English by the panel that displays it.
 */
function languageOptions(declared: string | undefined): readonly string[] {
  if (declared === undefined || THEME_LANGUAGES.includes(declared))
    return THEME_LANGUAGES;
  return [...THEME_LANGUAGES, declared];
}

/** The words this language actually spells, for the instant a clock would read. */
function sample(themeLanguage: string): string {
  return (
    formatInstant(
      instantIn(Date.now()),
      "MMMM dddd",
      undefined,
      themeLanguage,
    ) ?? ""
  );
}
