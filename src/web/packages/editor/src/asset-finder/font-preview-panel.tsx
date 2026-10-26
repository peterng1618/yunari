import type { AssetResult, FontCut, FontTrioInfo } from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type { TypePresets } from "../type-preset-manager/panel.js";
import { uiCopy } from "../ui-copy.js";

/** The trio's roles, in the order the card reads them: a trio that omits a
 *  role still draws heading, body, mono. */
export type FontRole = "heading" | "body" | "mono";

const ROLES = ["heading", "body", "mono"] as const;

/** A result with the font data the panel draws. `AssetResult.font` is optional
 *  on the wire; the finder selects only results that carry one. */
export type FontResult = AssetResult & {
  readonly font: {
    readonly cuts: readonly FontCut[];
    readonly trio?: FontTrioInfo;
  };
};

/** One preset entry, named as the scope row needs it. */
type RolePreset = TypePresets[string];

function rolePresets(
  presets: TypePresets,
  role: FontRole,
): readonly RolePreset[] {
  return Object.values(presets).filter(
    (entry) => entry.value.trioRole === role,
  );
}

export function cutsOf(selected: FontResult): readonly FontCut[] {
  const trio = selected.font.trio;
  if (trio === undefined) return selected.font.cuts;
  return ROLES.flatMap((role) => {
    const cut = trio.roles[role];
    return cut === undefined ? [] : [cut];
  });
}

/**
 * The face a family row is addressed by.
 *
 * A family's cuts are every published file — weight × subset — so position 0 is
 * whatever the provider listed first, which for a Google family is often a
 * subset with no Latin glyphs. Drawn or adopted, that face leaves the author's
 * own text in the browser fallback (a serif), while the row's own id names the
 * cut the host chose as the family's lead: this reads that id rather than an
 * array position.
 *
 * Search namespaces a row as `<source>:<entry id>`, and the entry id is the
 * cut's own id, so the prefix comes off before the comparison.
 */
export function leadCutOf(selected: {
  readonly id: string;
  readonly font?: { readonly cuts: readonly FontCut[] } | undefined;
}): FontCut | undefined {
  const cuts = selected.font?.cuts ?? [];
  const at = selected.id.indexOf(":");
  const entryId = at === -1 ? selected.id : selected.id.slice(at + 1);
  return cuts.find((cut) => cut.id === entryId) ?? cuts[0];
}

/** The faces an import brings with the chosen cut: every weight and style of
 *  the family's lead subset, so the preset's weight field has a face to draw at
 *  each weight, plus the chosen cut when the author picked another subset. */
export function familyCutsOf(
  selected: FontResult,
  chosen: FontCut,
): readonly FontCut[] {
  const lead = leadCutOf(selected) ?? chosen;
  const sameSubset = selected.font.cuts.filter(
    (cut) => cut.family === lead.family && cut.subset === lead.subset,
  );
  return sameSubset.some((cut) => cut.id === chosen.id)
    ? sameSubset
    : [...sameSubset, chosen];
}

export function faceStyle(cut: FontCut | undefined): React.CSSProperties {
  return cut === undefined
    ? {}
    : {
        fontFamily: cut.family,
        fontWeight: cut.weight,
        fontStyle: cut.style,
      };
}

/** Holds the specimen faces resident while the panel draws them, and frees
 *  every face it added on unmount or when the selection changes.
 *
 * The source is the provider's own CORS-open `previewUrl`; the editor declares
 * no Content-Security-Policy, so a remote font origin is allowed. A load that
 * fails leaves the card on its fallback family rather than blocking the panel. */
export function useSpecimens(cuts: readonly FontCut[]): void {
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (fonts === undefined || typeof FontFace === "undefined")
      return undefined;
    const added: FontFace[] = [];
    for (const cut of cuts) {
      try {
        const face = new FontFace(cut.family, `url(${cut.previewUrl})`, {
          weight: String(cut.weight),
          style: cut.style,
        });
        fonts.add(face);
        added.push(face);
        void face.load().catch(() => undefined);
      } catch {
        // A URL the browser refuses is the same as one the provider will not
        // serve: the card stays on its fallback face.
      }
    }
    return () => {
      for (const face of added) fonts.delete(face);
    };
  }, [cuts]);
}

/**
 * The finder's 336px preview column: the fixed specimen card, the author's
 * sample text, and the actions a chosen result makes available (spec R6, R7,
 * R9).
 *
 * Presentational plus the sample line: it draws from the result and the role
 * presets it is handed, and reports a press. It never reads a document and
 * never decides a write. An action whose callback is absent is not drawn,
 * because a button that cannot act is not an availability.
 */
export function FontPreviewPanel({
  selected,
  presets,
  onApplyTrio,
  onAddTrioPresets,
  onAddPreset,
  onApplyToSelected,
}: {
  readonly selected: FontResult;
  readonly presets: TypePresets;
  readonly onApplyTrio: ((trio: FontTrioInfo) => void) | undefined;
  readonly onAddTrioPresets: ((trio: FontTrioInfo) => void) | undefined;
  readonly onAddPreset:
    | ((cut: FontCut, role: FontRole, family: readonly FontCut[]) => void)
    | undefined;
  readonly onApplyToSelected:
    | ((cut: FontCut, family: readonly FontCut[]) => void)
    | undefined;
}): React.JSX.Element {
  const copy = uiCopy.assets.fontPreview;
  const trio = selected.font.trio;
  const [sample, setSample] = useState<string>(copy.sampleDefault);
  const [cutId, setCutId] = useState<string | undefined>(undefined);
  const [role, setRole] = useState<FontRole>("body");

  const cuts = useMemo(() => cutsOf(selected), [selected]);
  useSpecimens(cuts);
  /** Cuts that share a weight and style: their labels would read the same, so
   *  the subset is what names the difference between them. */
  const shared = useMemo(() => {
    const seen = new Map<string, number>();
    for (const cut of selected.font.cuts) {
      const key = `${cut.weight}|${cut.style}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set(
      selected.font.cuts
        .filter((cut) => (seen.get(`${cut.weight}|${cut.style}`) ?? 0) > 1)
        .map((cut) => cut.id),
    );
  }, [selected]);

  const selectedCut =
    selected.font.cuts.find((cut) => cut.id === cutId) ?? leadCutOf(selected);
  // No role-tagged preset means Apply has nothing to rewrite; only trio panels
  // draw that button, and only with it does the reason have a subject.
  const roleless = ROLES.every(
    (roleName) => rolePresets(presets, roleName).length === 0,
  );

  return (
    <section
      data-yunari-font-preview={trio === undefined ? "family" : "trio"}
      aria-label={trio === undefined ? copy.familyTitle : copy.trioTitle}
      className="flex w-[var(--font-preview-width)] flex-none flex-col gap-[var(--space-10)] rounded-[var(--radius-md)] border border-edge bg-[var(--panel)] p-[var(--space-12)]"
    >
      <div className="flex items-center gap-[var(--space-8)] border-b border-edge pb-[var(--space-6)]">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          {trio === undefined ? copy.familyTitle : copy.trioTitle}
        </span>
      </div>

      <div className="flex flex-col gap-[var(--space-4)]">
        <span className="text-sm font-semibold">
          {trio === undefined ? selected.name : trio.name}
        </span>
        <span className="text-xs text-muted">
          {trio === undefined ? selected.subtitle : trio.description}
        </span>
        {trio === undefined ? (
          <span className="font-mono text-[10px] text-faint">
            {uiCopy.assets.fontFamilyMeta(selected.font.cuts.length)} ·{" "}
            {selected.licence}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-[var(--space-6)]">
        <label htmlFor="font-preview-sample" className="text-xs text-muted">
          {copy.sampleLabel}
        </label>
        <input
          id="font-preview-sample"
          data-yunari-font-preview-sample=""
          value={sample}
          onChange={(event) => {
            setSample(event.target.value);
          }}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-6)] py-[var(--space-4)] text-xs"
        />
        <button
          type="button"
          data-yunari-font-preview-reset=""
          onClick={() => {
            setSample(copy.sampleDefault);
          }}
          className="text-[10px] text-faint"
        >
          {copy.sampleReset}
        </button>
      </div>

      {trio === undefined ? (
        <>
          <div
            data-yunari-font-specimen="family"
            className="flex h-[158px] flex-col justify-center gap-[var(--space-6)] rounded-[var(--radius-md)] bg-[image:var(--font-specimen-backdrop)] p-[var(--space-12)]"
          >
            <span
              style={faceStyle(selectedCut)}
              className="text-[length:var(--font-specimen-glyph-size)] leading-[1.08]"
            >
              {sample}
            </span>
            <span className="text-xs text-muted">{copy.glyphs}</span>
            {selectedCut === undefined ? null : (
              <span className="font-mono text-2xs text-faint">
                {selectedCut.family} · {selectedCut.weight}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-[var(--space-6)]">
            <div className="flex items-center gap-[var(--space-6)]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                {copy.cuts}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {selected.font.cuts.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-[var(--space-4)]">
              {selected.font.cuts.map((cut) => {
                const chosen = cut.id === selectedCut?.id;
                return (
                  <button
                    key={cut.id}
                    type="button"
                    aria-pressed={chosen}
                    data-yunari-font-cut={cut.id}
                    onClick={() => {
                      setCutId(cut.id);
                    }}
                    className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-6)] py-[var(--space-2)] text-[10px] text-muted aria-pressed:border-accent aria-pressed:text-accent"
                  >
                    {copy.cutLabel(
                      cut.weight,
                      cut.style === "italic",
                      shared.has(cut.id) ? cut.subset : undefined,
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] p-[var(--space-8)]">
            <span className="flex min-w-0 flex-col gap-[var(--space-2)]">
              <span className="text-[11px]">{copy.newPreset}</span>
              <span className="text-[10px] text-muted">
                {copy.newPresetSummary(
                  copy.role[role],
                  selectedCut?.family ?? selected.name,
                )}
              </span>
            </span>
            <label className="ml-auto flex items-center gap-[var(--space-4)] text-[10px] text-muted">
              {copy.roleLabel}
              <select
                data-yunari-font-role=""
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as FontRole);
                }}
                className="rounded-[var(--radius-sm)] border border-edge bg-[var(--bg)] px-[var(--space-4)] py-[var(--space-2)] text-[10px]"
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {copy.role[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-[var(--space-6)]">
            {onAddPreset === undefined || selectedCut === undefined ? null : (
              <button
                type="button"
                data-yunari-font-add-preset=""
                onClick={() => {
                  onAddPreset(
                    selectedCut,
                    role,
                    familyCutsOf(selected, selectedCut),
                  );
                }}
                className="rounded-[var(--radius-sm)] border border-accent px-[var(--space-12)] py-[var(--space-4)] text-xs text-accent"
              >
                {copy.addAsPreset}
              </button>
            )}
            {onApplyToSelected === undefined ||
            selectedCut === undefined ? null : (
              <button
                type="button"
                data-yunari-font-apply=""
                onClick={() => {
                  onApplyToSelected(
                    selectedCut,
                    familyCutsOf(selected, selectedCut),
                  );
                }}
                className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-12)] py-[var(--space-4)] text-xs text-muted"
              >
                {copy.applyToSelected}
              </button>
            )}
          </div>

          <p className="text-[10px] leading-[1.45] text-faint">
            {copy.familyNote}
          </p>
        </>
      ) : (
        <>
          <div
            data-yunari-font-specimen="trio"
            className="flex h-[var(--font-trio-specimen-height)] flex-col gap-[var(--space-6)] rounded-[var(--radius-md)] bg-[image:var(--font-specimen-backdrop)] p-[var(--space-12)]"
          >
            {ROLES.map((roleName) => {
              const cut = trio.roles[roleName];
              return (
                <span
                  key={roleName}
                  data-yunari-font-specimen-role={roleName}
                  style={faceStyle(cut)}
                  className={
                    roleName === "heading"
                      ? "text-lg leading-[1.12]"
                      : roleName === "body"
                        ? "text-xs leading-[1.5] text-muted"
                        : "mt-auto font-mono text-[10px]"
                  }
                >
                  {sample}
                </span>
              );
            })}
          </div>

          <div className="flex items-center gap-[var(--space-6)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              {copy.appliesTo}
            </span>
            <span className="flex-1 border-t border-edge" />
            <span className="text-2xs text-faint">{copy.addsMissingRoles}</span>
          </div>

          <div data-yunari-font-scope="" className="font-mono text-[10px]">
            {ROLES.map((roleName) =>
              copy.scopeCount(
                copy.role[roleName],
                rolePresets(presets, roleName).length,
              ),
            ).join(" · ")}
          </div>

          <div className="flex flex-col gap-[var(--space-4)]">
            {ROLES.map((roleName) => {
              const entries = rolePresets(presets, roleName);
              const after = trio.roles[roleName];
              const first = entries[0];
              return (
                <div
                  key={roleName}
                  data-yunari-font-scope-row={roleName}
                  className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-6)] py-[var(--space-4)]"
                >
                  <span className="flex items-center gap-[var(--space-6)]">
                    <span className="text-[10px]">{copy.role[roleName]}</span>
                    <span className="ml-auto font-mono text-2xs text-faint">
                      {entries.length === 0
                        ? copy.willBeCreated
                        : copy.roleCount(entries.length)}
                    </span>
                  </span>
                  {first === undefined || after === undefined ? null : (
                    <span
                      data-yunari-font-change={roleName}
                      className="font-mono text-[10px] text-muted"
                    >
                      {copy.change(
                        first.name,
                        first.value.weight,
                        after.family,
                        after.weight,
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {onApplyTrio !== undefined && roleless ? (
            <p
              data-yunari-font-apply-reason=""
              className="text-[10px] leading-[1.45] text-faint"
            >
              {copy.rolelessReason}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-[var(--space-6)]">
            {onApplyTrio === undefined ? null : (
              <button
                type="button"
                data-yunari-font-trio-apply=""
                data-yunari-font-apply=""
                disabled={roleless}
                onClick={() => {
                  onApplyTrio(trio);
                }}
                className="rounded-[var(--radius-sm)] bg-accent px-[var(--space-12)] py-[var(--space-4)] text-xs font-semibold text-[var(--bg)] disabled:opacity-50"
              >
                {copy.applyToTheme}
              </button>
            )}
            {onAddTrioPresets === undefined ? null : (
              <button
                type="button"
                data-yunari-font-add-presets=""
                onClick={() => {
                  onAddTrioPresets(trio);
                }}
                className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-12)] py-[var(--space-4)] text-xs"
              >
                {copy.addThreePresets}
              </button>
            )}
          </div>

          <p className="text-[10px] leading-[1.45] text-faint">
            {copy.trioNote}
          </p>
        </>
      )}
    </section>
  );
}
