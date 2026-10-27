import type * as React from "react";
import { useEffect, useState } from "react";
import {
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  type FontMetadata,
} from "../../asset-manager/font-metadata.js";
import { ControlNumber } from "../../components/ui/control-number.js";
import { ControlSelect } from "../../components/ui/control-select.js";
import { ControlText } from "../../components/ui/control-text.js";
import {
  FONT_ROLES,
  type FontTrioRole,
  ROLE_NAMES,
} from "../../type-preset-apply.js";
import { uiCopy } from "../../ui-copy.js";

export type { FontMetadata };

/** The words a font filename uses for a style, lowercased for the match. */
const STYLE_WORDS: Readonly<Record<string, "normal" | "italic">> = {
  italic: "italic",
  oblique: "italic",
  regular: "normal",
  normal: "normal",
  book: "normal",
  variable: "normal",
};

/** The words a font filename uses for a weight, lowercased for the match. */
const WEIGHT_WORDS: Readonly<Record<string, number>> = {
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/**
 * The family, weight and style a local file's name declares.
 *
 * Tokens are peeled from the end while they are a style or weight word — the
 * convention every publisher names a cut by — and the first token that is
 * neither ends the peel. Whatever is left was the family all along.
 */
export function fontMetadataFromFilename(filename: string): FontMetadata {
  const base = filename.replace(/\.[^.]+$/, "") || filename;
  const tokens = base.split(/[-_. ]+/).filter((token) => token !== "");
  let weight = 400;
  let style: "normal" | "italic" = "normal";

  while (tokens.length > 0) {
    const token = tokens.at(-1) ?? "";
    const lowered = token.toLowerCase();
    const wordedStyle = STYLE_WORDS[lowered];
    if (wordedStyle !== undefined) {
      style = wordedStyle;
      tokens.pop();
      continue;
    }
    const wordedWeight = WEIGHT_WORDS[lowered];
    if (wordedWeight !== undefined) {
      weight = wordedWeight;
      tokens.pop();
      continue;
    }
    const numeric = Number(lowered);
    if (/^\d+$/.test(lowered) && numeric >= 100 && numeric <= 900) {
      weight = numeric;
      tokens.pop();
      continue;
    }
    break;
  }

  const family = tokens.join(" ").trim() || base.trim();
  return { family, weight, style, licence: "unknown" };
}

const STYLE_OPTIONS = [
  { id: "normal", name: uiCopy.panels.fontStyle.normal },
  { id: "italic", name: uiCopy.panels.fontStyle.italic },
];

const ROLE_OPTIONS = [
  { id: "none", name: uiCopy.panels.none },
  ...FONT_ROLES.map((role) => ({ id: role, name: ROLE_NAMES[role] })),
];

/** The form's own refusal, in the two fields that can carry an unusable value. */
function refusalOf(
  family: string,
  weight: number | undefined,
): string | undefined {
  if (family.trim() === "") return uiCopy.controls.valueRequired;
  if (
    weight === undefined ||
    !Number.isFinite(weight) ||
    weight < FONT_WEIGHT_MIN ||
    weight > FONT_WEIGHT_MAX
  )
    return uiCopy.panels.invalidNumber;
  return undefined;
}

/**
 * The chosen font's metadata, drawn inline under its card — one form for the
 * fresh pick and for Create type preset on a declared face.
 *
 * No declaration happens here: **Create type preset** reports what the author
 * confirmed, and **Cancel** reports it too so a fresh pick can still be declared
 * with the values it arrived with. The credits and the preset are the caller's.
 */
export function FontMetadataForm(props: {
  readonly filename: string;
  readonly initial: FontMetadata;
  readonly busy: boolean;
  readonly onCommit: (
    metadata: FontMetadata,
    role: FontTrioRole | null,
  ) => void;
  readonly onCancel: (metadata: FontMetadata) => void;
  /** The role select is the Assets pane's: an import from the token inspector
   *  may never rewrite a role, so that caller draws the form without it and its
   *  commit reports `null`. */
  readonly showRole?: boolean;
  /** A field moved: the caller's own message about the last attempt no longer
   *  describes what is on the form. */
  readonly onEdit?: () => void;
}): React.JSX.Element {
  const {
    filename,
    initial,
    busy,
    onCommit,
    onCancel,
    showRole = true,
    onEdit,
  } = props;
  const [family, setFamily] = useState(initial.family);
  const [weight, setWeight] = useState<number | undefined>(initial.weight);
  const [style, setStyle] = useState<"normal" | "italic">(initial.style);
  const [licence, setLicence] = useState(initial.licence);
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl ?? "");
  const [role, setRole] = useState<FontTrioRole | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  // A second pick replaces the file under the same form: without this the
  // fields keep the first file's facts and Create would declare the new bytes
  // as the old family.
  useEffect(() => {
    setFamily(initial.family);
    setWeight(initial.weight);
    setStyle(initial.style);
    setLicence(initial.licence);
    setSourceUrl(initial.sourceUrl ?? "");
    setRole(null);
    setRefusal(undefined);
  }, [initial]);

  const current = (): FontMetadata => {
    const url = sourceUrl.trim();
    return {
      family: family.trim(),
      weight: weight ?? Number.NaN,
      style,
      licence: licence.trim() === "" ? "unknown" : licence.trim(),
      ...(url === "" ? {} : { sourceUrl: url }),
    };
  };

  return (
    <section
      data-yunari-font-details=""
      className="flex flex-col gap-[var(--space-8)] border-t border-edge-2 bg-panel-2 p-[var(--space-8)]"
    >
      <div className="flex flex-col gap-[var(--space-2)]">
        <h4 className="text-2xs font-semibold uppercase tracking-[0.11em] text-faint">
          {uiCopy.panels.fontDetails}
        </h4>
        <span className="truncate text-xs text-muted">{filename}</span>
      </div>
      <ControlText
        label={uiCopy.panels.family}
        data={{ "data-yunari-font-family": "" }}
        value={family}
        disabled={busy}
        onCommit={(next) => {
          onEdit?.();
          setFamily(next);
        }}
      />
      <ControlNumber
        label={uiCopy.panels.weight}
        data={{ "data-yunari-font-weight": "" }}
        value={weight}
        disabled={busy}
        onCommit={(next) => {
          onEdit?.();
          setWeight(next);
        }}
        onClear={() => {
          onEdit?.();
          setWeight(undefined);
        }}
      />
      <ControlSelect
        label={uiCopy.panels.style}
        data={{ "data-yunari-font-style": "" }}
        value={style}
        options={STYLE_OPTIONS}
        onChange={(next) => {
          onEdit?.();
          setStyle(next === "italic" ? "italic" : "normal");
        }}
      />
      <ControlText
        label={uiCopy.panels.licence}
        data={{ "data-yunari-font-licence": "" }}
        value={licence}
        disabled={busy}
        onCommit={(next) => {
          onEdit?.();
          setLicence(next);
        }}
      />
      <ControlText
        label={uiCopy.panels.sourceUrl}
        data={{ "data-yunari-font-source-url": "" }}
        value={sourceUrl}
        disabled={busy}
        onCommit={(next) => {
          onEdit?.();
          setSourceUrl(next);
        }}
      />
      {showRole ? (
        <ControlSelect
          label={uiCopy.panels.role}
          data={{ "data-yunari-font-role": "" }}
          value={role ?? "none"}
          options={ROLE_OPTIONS}
          onChange={(next) => {
            onEdit?.();
            setRole(next === "none" ? null : (next as FontTrioRole));
          }}
        />
      ) : null}
      <p className="text-2xs text-faint">{uiCopy.panels.fontDeclaredNote}</p>
      {refusal === undefined ? null : (
        <p role="alert" className="text-xs text-warn">
          {refusal}
        </p>
      )}
      <div className="flex items-center gap-[var(--space-6)]">
        <button
          type="button"
          data-yunari-font-create=""
          disabled={busy}
          onClick={() => {
            const candidate = current();
            const reason = refusalOf(family, weight);
            setRefusal(reason);
            if (reason === undefined) onCommit(candidate, role);
          }}
          className="rounded-[var(--radius-md)] bg-accent px-[var(--space-8)] py-[var(--space-4)] text-xs font-semibold text-[var(--bg)] disabled:opacity-50"
        >
          {uiCopy.panels.assetCard.createTypeToken}
        </button>
        <button
          type="button"
          data-yunari-font-cancel=""
          disabled={busy}
          // An invalid edit must not trap the author behind Cancel: the file is
          // declared with the values it arrived with, never with a coerced one.
          onClick={() =>
            onCancel(
              refusalOf(family, weight) === undefined ? current() : initial,
            )
          }
          className="rounded-[var(--radius-md)] border border-edge px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted"
        >
          {uiCopy.panels.cancel}
        </button>
      </div>
    </section>
  );
}
